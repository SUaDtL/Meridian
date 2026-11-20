import { createProjectSaveQueue, type ProjectSaveState } from '../persistence/project-save-queue';
import { readWorkspaceProject, writeWorkspaceProject } from '../persistence/workspace-db';
import { serializeProject } from '../storage';
import { canonicalJson } from './base-token';
import { buildDesignRecipeCandidate, readDesignRecipe, type DesignRecipeId } from './design-recipes';
import type { MermaidProjectV3 } from './mermaid-project';
import { prepareFlowchartCandidate, type NativeFlowchartEdit } from './project-flowchart';
import { renderMermaidProject } from './project-render';
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
  const structure = new WeakMap<ReadyProposal, { base: MermaidProjectV3; next: MermaidProjectV3; elementId: string }>();
  const designs = new WeakMap<ReadyProposal, {
    base: MermaidProjectV3;
    dependency: string;
    candidate: ReturnType<typeof buildDesignRecipeCandidate>;
    rendered: Awaited<ReturnType<typeof renderMermaidProject>>;
  }>();
  let closed = false;

  function prepareHeading(envelope: unknown) {
    return headingLane.prepare({ document: current.document, revision: current.document.revision }, envelope);
  }

  function applyHeading(proposal: ReadyProposal) {
    if (closed) return 'invalid';
    const result = headingLane.resolve(proposal, current.document, current.document.revision);
    if (result.status !== 'ready') return result.status;
    return commit(result.document);
  }

  async function prepareStructure(edit: NativeFlowchartEdit, signal?: AbortSignal): Promise<ReadyProposal> {
    const base = current.document;
    const { document, elementId } = await prepareFlowchartCandidate(base, { ...edit }, signal);
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    structure.set(proposal, { base, next: freezeSnapshot(document), elementId });
    return proposal;
  }

  function applyStructure(proposal: ReadyProposal) {
    const change = structure.get(proposal);
    if (closed || !change) return { status: 'invalid' } as const;
    if (change.base !== current.document) return { status: 'stale' } as const;
    const status = commit(change.next);
    return { status, elementId: status === 'applied' || status === 'unchanged' ? change.elementId : undefined };
  }

  function readStructurePreview(proposal: ReadyProposal) {
    const change = structure.get(proposal);
    return !closed && change?.base === current.document ? change.next : undefined;
  }

  async function prepareDesign(id: DesignRecipeId, signal?: AbortSignal) {
    if (closed) throw new Error('The project is closed.');
    signal?.throwIfAborted();
    const base = current.document;
    const candidate = buildDesignRecipeCandidate(base, id);
    const rendered = await renderMermaidProject(candidate.document, signal);
    signal?.throwIfAborted();
    if (!rendered.targetTable) throw new Error('This design can only be previewed on a verified flowchart.');
    if (closed || current.document !== base) throw new Error('The project changed. Refresh the design preview.');
    const proposal: ReadyProposal = Object.freeze({ id: crypto.randomUUID(), state: 'ready' });
    designs.set(proposal, { base, candidate: freezeSnapshot(candidate),
      rendered, dependency: canonicalJson(candidate.recipe) });
    return proposal;
  }

  function readDesignPreview(proposal: ReadyProposal) {
    const change = designs.get(proposal);
    if (closed || !change || change.base !== current.document) return undefined;
    return { ...change.candidate, rendered: change.rendered };
  }

  function applyDesign(proposal: ReadyProposal) {
    const change = designs.get(proposal);
    if (closed || !change) return 'invalid';
    if (change.base !== current.document || change.dependency !== canonicalJson(readDesignRecipe(change.candidate.recipe.id))) return 'stale';
    return commit(change.candidate.document);
  }

  function commit(document: MermaidProjectV3) {
    if (document === current.document) return 'unchanged';
    const next = historyEntry(document);
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
    prepareStructure,
    readStructurePreview,
    applyStructure,
    prepareDesign,
    readDesignPreview,
    applyDesign,
    undo: () => restore(past, future),
    redo: () => restore(future, past),
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    saveState: queue.state,
    flush: queue.flush,
    retrySave: queue.retry,
    close() {
      closed = true;
      queue.dispose();
    },
  };
}
