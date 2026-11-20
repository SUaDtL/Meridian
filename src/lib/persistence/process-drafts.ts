import { encodeMermaidLabel, authoringLimits } from '../authoring/flowchart-source';
import { adjacentConnections, maxProcessConnections, type ProcessConnections } from '../authoring/process-connections';
import { maxProcessSourceRows, type ProcessStep } from '../authoring/process-steps';
import { elementUuidPattern } from '../authoring/identities';

import { discardGuidedCheckpoint, draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

function makeCheckpoint(title: string, steps: readonly ProcessStep[], id: string, timestamp: number, connections?: ProcessConnections) {
  if (!Number.isFinite(timestamp) || typeof id !== 'string' || !elementUuidPattern.test(id)
    || typeof title !== 'string' || title.length > 120 || /[\uD800-\uDFFF]/u.test(title)
    || !steps.length || steps.length > authoringLimits.graphNodes) throw new Error('This draft cannot be saved.');
  let previousLine = 0;
  const seenLines = new Set<number>();
  const nodes = steps.map(({ line, label }, index) => {
    if (!Number.isSafeInteger(line) || line < 1 || line > authoringLimits.sourceCodeUnits + 1 || seenLines.has(line)
      || (!connections && line <= previousLine)) {
      throw new Error('The draft row order is invalid.');
    }
    previousLine = line;
    seenLines.add(line);
    encodeMermaidLabel(label);
    return { id: `step-${connections ? line : index + 1}`, label, role: null,
      shape: connections?.decisions.includes(line) ? 'diamond' as const : 'rect' as const, sourceRow: line };
  });
  const stepIds = new Map(nodes.map(node => [node.sourceRow, node.id]));
  function nodeId(line: number) {
    const stepId = stepIds.get(line);
    if (!stepId) throw new Error('A draft connection refers to a missing step.');
    return stepId;
  }
  const edges = connections?.edges ?? adjacentConnections(steps);
  if (edges.length > maxProcessConnections || new Set(edges.map(edge => edge.id)).size !== edges.length) {
    throw new Error('The draft connection list is invalid.');
  }
  const terminalNodeIds = connections?.terminal.map(nodeId) ?? [];
  if (new Set(terminalNodeIds).size !== terminalNodeIds.length) throw new Error('The draft has repeated end steps.');
  return {
    schema: 'meridian-draft/v1' as const,
    id,
    feature: 'guided' as const,
    baseToken: null,
    createdAt: new Date(timestamp).toISOString(),
    expiresAt: new Date(timestamp + draftWeek).toISOString(),
    payload: {
      intent: 'process' as const, mode: connections ? 'connections' as const : 'linear' as const, step: 'connections' as const,
      title, subtitle: '', direction: 'LR' as const,
      destination: { mode: 'new' as const, targetProjectId: null },
      nodes,
      edges: edges.map(({ id, from, to, label, review }) => {
        if (typeof id !== 'string' || !/^connection-[a-z0-9-]{1,48}$/.test(id)
          || typeof label !== 'string' || (review !== 'accepted' && review !== 'needs-review')) {
          throw new Error('A draft connection is invalid.');
        }
        if (label) encodeMermaidLabel(label);
        return { id, sourceId: nodeId(from), targetId: nodeId(to), label, direction: 'forward' as const, review };
      }),
      groups: [],
      terminalNodeIds,
      mapping: { id: null, label: null, source: null, target: null, role: null },
    },
  };
}

export type ProcessCheckpoint = ReturnType<typeof makeCheckpoint>;
export function checkpointConnections({ payload }: ProcessCheckpoint): ProcessConnections | undefined {
  if (payload.mode === 'linear') return undefined;
  const lines = new Map(payload.nodes.map(node => [node.id, node.sourceRow]));
  function lineOf(id: string) {
    const line = lines.get(id);
    if (line === undefined) throw new Error('A draft connection refers to a missing step.');
    return line;
  }
  return {
    decisions: payload.nodes.filter(node => node.shape === 'diamond').map(node => node.sourceRow),
    terminal: payload.terminalNodeIds.map(lineOf),
    edges: payload.edges.map(edge => ({ id: edge.id, from: lineOf(edge.sourceId), to: lineOf(edge.targetId),
      label: edge.label, review: edge.review })),
  };
}

function readCheckpoint(value: unknown): ProcessCheckpoint | undefined {
  try {
    const record = value as ProcessCheckpoint;
    if (record?.feature !== 'guided' || !['linear', 'connections'].includes(record.payload?.mode)) return undefined;
    const normalized = record.payload.nodes.map(node => ({ line: node.sourceRow, original: node.label, label: node.label }));
    const expected = makeCheckpoint(record.payload.title, normalized, record.id, Date.parse(record.createdAt), checkpointConnections(record));
    return sameCheckpoint(record, expected) && draftBytes(expected) <= maxDraftBytes ? expected : undefined;
  } catch {
    return undefined;
  }
}

export function listProcessCheckpoints(db: IDBDatabase) {
  return listGuidedCheckpoints(db, readCheckpoint);
}

export async function saveProcessCheckpoint(
  db: IDBDatabase, title: string, steps: readonly ProcessStep[], previous?: ProcessCheckpoint, connections?: ProcessConnections,
): Promise<ProcessCheckpoint> {
  if (steps.some(step => step.line > maxProcessSourceRows)) throw new Error('This draft contains a step beyond line 10,000.');
  const now = Date.now();
  const next = makeCheckpoint(title, steps, previous?.id ?? crypto.randomUUID(), now, connections);
  return saveGuidedCheckpoint(db, next, previous, now);
}

export const discardProcessCheckpoint = discardGuidedCheckpoint;
