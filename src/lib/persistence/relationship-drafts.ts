import { elementUuidPattern } from '../authoring/identities';
import { authoringLimits, encodeMermaidLabel } from '../authoring/flowchart-source';
import { tableInputLimits } from '../authoring/delimited-input';
import { systemRoles, type RelationshipColumns, type RelationshipGraph } from '../authoring/relationship-table';
import { draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

export function makeRelationshipCheckpoint(title: string, graph: RelationshipGraph, columns: RelationshipColumns, id: string, timestamp: number) {
  if (!Number.isFinite(timestamp) || typeof id !== 'string' || !elementUuidPattern.test(id)
    || typeof title !== 'string' || title.length > 120 || /[\uD800-\uDFFF]/u.test(title)
    || !graph.nodes.length || graph.nodes.length > authoringLimits.graphNodes || graph.edges.length > 400) {
    throw new Error('This table draft cannot be saved.');
  }
  function mapped(column: number | null) {
    if (column === null) return null;
    if (!Number.isInteger(column) || column < 0 || column >= tableInputLimits.columns) throw new Error('A table column is out of bounds.');
    return `column-${column + 1}`;
  }
  const edgeList = columns.mode === 'edges';
  if (edgeList && (columns.source === null || columns.target === null || columns.source === columns.target)) throw new Error('Map both endpoints.');
  if (!edgeList && (columns.label === null || (columns.source === null) !== (columns.target === null)
    || (columns.source !== null && columns.id === null))) throw new Error('The table mapping is incomplete.');

  let lastRow = 0;
  const nodeIds = new Set<string>();
  const nodes = graph.nodes.map(({ key, label, role, sourceRow }, index) => {
    if (!Number.isInteger(sourceRow) || (edgeList ? sourceRow < Math.max(1, lastRow) : sourceRow <= lastRow) || sourceRow > tableInputLimits.rows
      || key !== (edgeList ? `endpoint-${index + 1}` : `row-${sourceRow}`) || typeof label !== 'string' || !label.trim()
      || (role !== null && !systemRoles.includes(role))) throw new Error('A normalized system row is invalid.');
    encodeMermaidLabel(label);
    lastRow = sourceRow;
    nodeIds.add(key);
    return { id: key, label, role, shape: 'rect' as const, sourceRow };
  });
  const edges = graph.edges.map(({ from, to, label }, index) => {
    if (!nodeIds.has(from) || !nodeIds.has(to)) throw new Error('A draft relationship points to a missing system.');
    if (label) encodeMermaidLabel(label);
    return { id: `connection-${index + 1}`, sourceId: from, targetId: to, label: label ?? '', direction: 'forward' as const, review: 'accepted' as const };
  });
  return {
    schema: 'meridian-draft/v1' as const, id, feature: 'guided' as const, baseToken: null,
    createdAt: new Date(timestamp).toISOString(), expiresAt: new Date(timestamp + draftWeek).toISOString(),
    payload: {
      intent: 'systems' as const, mode: 'connections' as const, step: 'connections' as const,
      title, subtitle: '', direction: 'LR' as const, destination: { mode: 'new' as const, targetProjectId: null },
      nodes, edges, groups: [], terminalNodeIds: [],
      mapping: { id: mapped(columns.id), label: mapped(columns.label), role: mapped(columns.role),
        source: mapped(columns.source), target: mapped(columns.target),
        ...(edgeList && { mode: "edges" as const, edgeLabel: mapped(columns.edgeLabel ?? null) }) },
    },
  };
}

export type RelationshipCheckpoint = ReturnType<typeof makeRelationshipCheckpoint>;

export function normalizedRelationshipDraft({ payload }: RelationshipCheckpoint) {
  const graph: RelationshipGraph = {
    nodes: payload.nodes.map(({ id, label, role, sourceRow }) => ({ key: id, label, role, sourceRow })),
    edges: payload.edges.map(({ sourceId, targetId, label }) => ({ from: sourceId, to: targetId, ...(label ? { label } : {}) })),
  };
  function column(value: string | null) {
    if (value === null) return null;
    if (!/^column-[1-9]\d{0,2}$/.test(value)) throw new Error('The saved column is invalid.');
    return Number(value.slice('column-'.length)) - 1;
  }
  const mapping = payload.mapping;
  const label = column(mapping.label);
  if (mapping.mode !== 'edges' && label === null) throw new Error('The system label column is missing.');
  const columns: RelationshipColumns = { ...(mapping.mode === "edges" && { mode: "edges", edgeLabel: column(mapping.edgeLabel ?? null) }), label, id: column(mapping.id), role: column(mapping.role),
    source: column(mapping.source), target: column(mapping.target) };
  return { graph, columns };
}

function readCheckpoint(value: unknown) {
  try {
    const record = value as RelationshipCheckpoint;
    if (record?.feature !== 'guided' || record.payload?.intent !== 'systems') return undefined;
    const { graph, columns } = normalizedRelationshipDraft(record);
    const expected = makeRelationshipCheckpoint(record.payload.title, graph, columns, record.id, Date.parse(record.createdAt));
    return sameCheckpoint(record, expected) && draftBytes(expected) <= maxDraftBytes ? expected : undefined;
  } catch {
    return undefined;
  }
}

export function listRelationshipCheckpoints(db: IDBDatabase) {
  return listGuidedCheckpoints(db, readCheckpoint);
}

export async function saveRelationshipCheckpoint(db: IDBDatabase, title: string, graph: RelationshipGraph, columns: RelationshipColumns, previous?: RelationshipCheckpoint) {
  const now = Date.now();
  const next = makeRelationshipCheckpoint(title, graph, columns, previous?.id ?? crypto.randomUUID(), now);
  return saveGuidedCheckpoint(db, next, previous, now);
}
