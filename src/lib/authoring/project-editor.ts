import { createProjectSaveQueue, type ProjectSaveState } from '../persistence/project-save-queue';
import { readWorkspaceProject, writeWorkspaceProject } from '../persistence/workspace-db';
import { serializeProject } from '../storage';
import type { MermaidProjectV3 } from './mermaid-project';
import { createHeadingProposalLane, type ReadyProposal } from './proposals';
import { validateMermaidProject } from './validate-mermaid-project';

const historyByteLimit = 8 * 1024 * 1024;
const historyEntryLimit = 50;
const encoder = new TextEncoder();

function freezeSnapshot<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}

const headingLane = createHeadingProposalLane<MermaidProjectV3>((draft, base) =>
  draft === base.document ? draft : freezeSnapshot(validateMermaidProject({ ...draft, revision: base.revision + 1 })));

function historyEntry(document: MermaidProjectV3) {
  return { document, bytes: encoder.encode(serializeProject(document)).byteLength };
}

/** Open the verified durable revision and edit through prepared snapshots. */
export async function openStoredProjectEditor(db: IDBDatabase, id: string, notify: (state: ProjectSaveState) => void) {
  const stored = await readWorkspaceProject(db, id);
  if (!stored) throw new Error('The saved Meridian project could not be found.');
  let current = historyEntry(freezeSnapshot(stored.document));
  const queue = createProjectSaveQueue(current.document, stored.anchor, (document, anchor) =>
    writeWorkspaceProject(db, document, anchor), notify);
  const past: (typeof current)[] = [];
  const future: (typeof current)[] = [];
  let closed = false;

  function prepareHeading(envelope: unknown) {
    return headingLane.prepare({ document: current.document, revision: current.document.revision }, envelope);
  }

  function applyHeading(proposal: ReadyProposal) {
    if (closed) return 'invalid';
    const result = headingLane.resolve(proposal, current.document, current.document.revision);
    if (result.status !== 'ready') return result.status;
    if (result.document === current.document) return 'unchanged';
    const next = historyEntry(result.document);
    if (current.bytes + next.bytes > historyByteLimit) return 'history-limit';
    past.push(current);
    future.length = 0;
    let bytes = next.bytes;
    let start = past.length;
    while (start > 0 && past.length - start < historyEntryLimit && bytes + past[start - 1].bytes <= historyByteLimit) {
      bytes += past[--start].bytes;
    }
    past.splice(0, start);
    current = next;
    queue.edit(next.document);
    return 'applied';
  }

  function restore(from: typeof past, to: typeof past) {
    const previous = from.at(-1);
    if (closed || !previous) return false;
    const document = Object.freeze({ ...previous.document, revision: current.document.revision + 1, updatedAt: new Date().toISOString() });
    validateMermaidProject(document);
    to.push(current);
    from.pop();
    current = historyEntry(document);
    queue.edit(document);
    return true;
  }

  return {
    snapshot: () => current.document,
    prepareHeading,
    applyHeading,
    undo: () => restore(past, future),
    redo: () => restore(future, past),
    saveState: queue.state,
    flush: queue.flush,
    retrySave: queue.retry,
    close() {
      closed = true;
      queue.dispose();
    },
  };
}
