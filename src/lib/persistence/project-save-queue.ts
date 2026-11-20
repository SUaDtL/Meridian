import { StorageConflict, type SavedAnchor } from './workspace-db';

const quietSaveDelay = 450;
const maximumCheckpointDelay = 2_000;

type VersionedProject = { readonly id: string; readonly revision: number };
type SaveWriter<Project> = (document: Project, expected: SavedAnchor | null) => Promise<SavedAnchor>;

export interface ProjectSaveState {
  phase: 'saved' | 'scheduled' | 'saving' | 'conflict' | 'error';
  workingRevision: number;
  savedRevision: number | null;
  anchor: SavedAnchor | null;
  message?: string;
}

/** Queue immutable reducer snapshots for a single project and one observed anchor. */
export function createProjectSaveQueue<Project extends VersionedProject>(
  initial: Project,
  initialAnchor: SavedAnchor | null,
  write: SaveWriter<Project>,
  notify: (state: ProjectSaveState) => void,
) {
  let working = initial;
  let saved: Project | null = initialAnchor === null ? null : initial;
  let anchor = initialAnchor && { ...initialAnchor };
  let dirtySince: number | null = saved ? null : Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void> | undefined;
  let failure: { phase: 'conflict' | 'error'; message: string } | undefined;
  let disposed = false;

  function state(): ProjectSaveState {
    return {
      phase: failure?.phase ?? (pending ? 'saving' : working === saved ? 'saved' : 'scheduled'),
      workingRevision: working.revision,
      savedRevision: saved?.revision ?? null,
      anchor: anchor && { ...anchor },
      ...(failure ? { message: failure.message } : {}),
    };
  }

  function report() {
    if (!disposed) notify(state());
  }

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule() {
    clearTimer();
    if (disposed || failure || pending || dirtySince === null) return;
    const delay = Math.max(0, Math.min(quietSaveDelay, dirtySince + maximumCheckpointDelay - Date.now()));
    timer = setTimeout(() => { void flush(); }, delay);
  }

  function flush(): Promise<void> {
    if (pending) return pending;
    if (disposed || failure || working === saved) return Promise.resolve();
    clearTimer();
    pending = Promise.resolve().then(async () => {
      while (!disposed && working !== saved && !failure) {
        const captured = working;
        try {
          anchor = { ...await write(captured, anchor && { ...anchor }) };
          saved = captured;
          if (working === saved) dirtySince = null;
        } catch (reason) {
          failure = {
            phase: reason instanceof StorageConflict ? 'conflict' : 'error',
            message: reason instanceof Error ? reason.message : 'Meridian could not save the current project.',
          };
        }
      }
    }).finally(() => {
      pending = undefined;
      schedule();
      report();
    });
    report();
    return pending;
  }

  function edit(next: Project) {
    if (disposed || next === working) return;
    if (next.id !== initial.id || !Number.isSafeInteger(next.revision) || next.revision <= working.revision) {
      throw new Error('A project save requires a newer working revision of the same project.');
    }
    working = next;
    dirtySince ??= Date.now();
    schedule();
    report();
  }

  function retry(): Promise<void> {
    if (failure?.phase === 'error') failure = undefined;
    return flush();
  }

  function dispose() {
    disposed = true;
    clearTimer();
  }

  schedule();
  return { state, edit, flush, retry, dispose };
}
