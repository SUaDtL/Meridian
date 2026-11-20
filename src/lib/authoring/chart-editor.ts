import { createProjectSaveQueue, type ProjectSaveState } from '../persistence/project-save-queue';
import { readWorkspaceProject, writeWorkspaceProject } from '../persistence/workspace-db';
import { canonicalJson, projectBaseToken, sameBaseToken, type BaseToken } from './base-token';
import type { ChartProject, ChartSpec } from './chart-data';
import { validateChartProject } from './chart-project';
import type { ReadyProposal } from './proposals';

type ChartEdit = { title: string; subtitle: string; chartSpec: ChartSpec; frame: ChartProject['frame'] };
type Accepted = ReturnType<typeof validateChartProject>;
const maxHistory = 50;
const maxBytes = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

function freeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function entry(project: ChartProject) {
  const { dataset: _dataset, ...metadata } = project;
  return { project, bytes: bytes(metadata) };
}

/** Keep a chart's immutable dataset shared by each saved mapping/frame snapshot. */
export async function openChartProjectEditor(db: IDBDatabase, id: string, notify: (state: ProjectSaveState) => void) {
  const stored = await readWorkspaceProject(db, id, 'chart');
  if (!stored) throw new Error('The saved chart could not be found.');
  let accepted = freeze(validateChartProject(stored.document));
  let current = entry(accepted.project);
  const datasetBytes = bytes(current.project.dataset);
  const queue = createProjectSaveQueue(current.project, stored.anchor, (project, anchor) =>
    writeWorkspaceProject(db, project, anchor), notify);
  const earlier: (typeof current)[] = [];
  const later: (typeof current)[] = [];
  const proposals = new WeakMap<ReadyProposal, { base: ChartProject; token: BaseToken; next: Accepted }>();
  let closed = false;

  async function prepare(edit: ChartEdit, expected: ChartProject) {
    const base = current.project;
    if (closed || expected !== base) throw new Error('The chart changed. Reopen the mapping before previewing it.');
    const { title, subtitle, chartSpec, frame } = structuredClone(edit);
    const next = freeze(validateChartProject({
      ...base, title, subtitle, chartSpec, frame, revision: base.revision + 1, updatedAt: new Date().toISOString(),
    }));
    const token = await projectBaseToken(base);
    if (closed || current.project !== base) throw new Error('The chart changed. Reopen the mapping before previewing it.');
    const proposal: ReadyProposal = Object.freeze({ state: 'ready', id: crypto.randomUUID() });
    proposals.set(proposal, { base, token, next });
    return { proposal, next };
  }

  async function apply(proposal: ReadyProposal) {
    const record = proposals.get(proposal);
    if (closed || !record) return 'invalid';
    if (record.base !== current.project) return 'stale';
    const token = await projectBaseToken(current.project);
    if (closed || record.base !== current.project || !sameBaseToken(token, record.token)) return 'stale';
    const { title, subtitle, chartSpec, frame } = record.base;
    const after = record.next.project;
    if (title === after.title && subtitle === after.subtitle
      && canonicalJson(chartSpec) === canonicalJson(after.chartSpec) && canonicalJson(frame) === canonicalJson(after.frame)) return 'unchanged';
    const next = entry(after);
    if (datasetBytes + current.bytes + next.bytes > maxBytes) return 'history-limit';
    earlier.push(current);
    later.length = 0;
    current = next;
    accepted = record.next;
    let remaining = datasetBytes + current.bytes;
    let keep = earlier.length;
    while (keep > 0 && earlier.length - keep < maxHistory && remaining + earlier[keep - 1].bytes <= maxBytes) {
      remaining += earlier[--keep].bytes;
    }
    earlier.splice(0, keep);
    queue.edit(current.project);
    return 'applied';
  }

  function restore(from: typeof earlier, to: typeof earlier) {
    const remembered = from.at(-1);
    if (closed || !remembered) return false;
    const project = { ...remembered.project, revision: current.project.revision + 1, updatedAt: new Date().toISOString() };
    const next = freeze(validateChartProject(project));
    to.push(current);
    from.pop();
    accepted = next;
    current = entry(next.project);
    queue.edit(project);
    return true;
  }

  return {
    snapshot: () => accepted,
    saveState: queue.state,
    prepare, apply,
    canUndo: () => !!earlier.length,
    canRedo: () => !!later.length,
    undo: () => restore(earlier, later),
    redo: () => restore(later, earlier),
    flush: queue.flush,
    retry: queue.retry,
    dispose: () => { closed = true; queue.dispose(); },
  };
}
