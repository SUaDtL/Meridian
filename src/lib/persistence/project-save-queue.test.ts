import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectSaveQueue, type ProjectSaveState } from './project-save-queue';
import { StorageConflict, type SavedAnchor } from './workspace-db';

const project = (revision: number) => ({ id: 'same-project', revision, title: `Heading ${revision}` });
const anchor = (revision: number): SavedAnchor => ({ storageGeneration: `generation-${revision}`, stateDigest: `digest-${revision}` });

describe('revision-aware autosave queue', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  it('coalesces several edits during a slow save and confirms only the newest checkpoint', async () => {
    const milestones: ProjectSaveState[] = [];
    const pending: ((value: SavedAnchor) => void)[] = [];
    const write = vi.fn((_document: ReturnType<typeof project>, _expected: SavedAnchor | null) =>
      new Promise<SavedAnchor>(resolve => pending.push(resolve)));
    const queue = createProjectSaveQueue(project(0), anchor(0), write, value => milestones.push(value));
    queue.edit(project(1));
    await vi.advanceTimersByTimeAsync(449);
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(write).toHaveBeenCalledExactlyOnceWith(project(1), anchor(0));

    queue.edit(project(2));
    queue.edit(project(3));
    // Undo also advances the working revision.
    const undo = { ...project(4), title: 'Heading 2' };
    queue.edit(undo);
    const completion = queue.flush();
    expect(queue.flush()).toBe(completion);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(write).toHaveBeenCalledTimes(1);

    pending[0](anchor(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(write).toHaveBeenLastCalledWith(undo, anchor(1));
    expect(write).toHaveBeenCalledTimes(2);
    expect(queue.state()).toMatchObject({ phase: 'saving', savedRevision: 1, workingRevision: 4 });
    expect(milestones.some(value => value.phase === 'saved')).toBe(false);

    pending[1](anchor(4));
    await completion;
    expect(queue.state()).toMatchObject({ phase: 'saved', savedRevision: 4, workingRevision: 4, anchor: anchor(4) });
    queue.dispose();
  });

  it('attempts an initial save and services continuous typing within the checkpoint interval', async () => {
    const write = vi.fn(async (value: ReturnType<typeof project>) => anchor(value.revision));
    const queue = createProjectSaveQueue(project(0), null, write, vi.fn());
    for (let revision = 1; revision <= 4; revision++) {
      await vi.advanceTimersByTimeAsync(400);
      queue.edit(project(revision));
    }
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(write).toHaveBeenCalledExactlyOnceWith(project(4), null);
    expect(queue.state().phase).toBe('saved');
    queue.dispose();
  });

  it('retains unsaved data through transient failure and retries with the same anchor', async () => {
    const write = vi.fn<(value: ReturnType<typeof project>, expected: SavedAnchor | null) => Promise<SavedAnchor>>();
    write.mockRejectedValueOnce(new Error('Storage is unavailable')).mockResolvedValueOnce(anchor(2));
    const queue = createProjectSaveQueue(project(0), anchor(0), write, vi.fn());
    queue.edit(project(1));
    await queue.flush();
    expect(queue.state()).toMatchObject({ phase: 'error', savedRevision: 0, workingRevision: 1, message: 'Storage is unavailable' });
    queue.edit(project(2));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(write).toHaveBeenCalledTimes(1);
    await queue.retry();
    expect(write).toHaveBeenLastCalledWith(project(2), anchor(0));
    expect(queue.state()).toMatchObject({ phase: 'saved', savedRevision: 2 });
    queue.dispose();
  });

  it('pauses on a storage conflict even if the caller asks to retry', async () => {
    const write = vi.fn().mockRejectedValue(new StorageConflict());
    const queue = createProjectSaveQueue(project(0), anchor(0), write, vi.fn());
    queue.edit(project(1));
    await queue.flush();
    expect(queue.state()).toMatchObject({ phase: 'conflict', savedRevision: 0, workingRevision: 1 });
    queue.edit(project(2));
    await queue.retry();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(queue.state()).toMatchObject({ phase: 'conflict', savedRevision: 0, workingRevision: 2 });
    queue.dispose();
  });

  it('cancels undispatched work when the project closes', async () => {
    const write = vi.fn();
    const queue = createProjectSaveQueue(project(0), null, write, vi.fn());
    queue.edit(project(1));
    queue.dispose();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(write).not.toHaveBeenCalled();
  });
});
