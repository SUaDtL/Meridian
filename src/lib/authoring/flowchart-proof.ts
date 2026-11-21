import type { RenderResult, StudioDocument } from '../../types';
import type { FlowModel } from '../design';
import { flowchartModelFor, renderDiagram } from '../render';
import { canonicalJson } from './base-token';
import { flowchartEngineConnections, flowchartEngineShapes, type ConnectionDirection, type Shape } from './flowchart-source';
import { applySourcePatches, flowchartSubsetTopology, groupedFlowchartTopology, planAddNext, planEdgeAddition, planEdgeLabel, planEdgeRemoval, planEdgeSelectionRemoval, planFlowchartFragment, planGroupContentsRemoval, planGroupCreation, planGroupRemoval, planMoveToGroup, planNodeAddition, planNodeLabel, planNodeRemoval, type FlowchartFragment, type SourcePatch } from './source-patches';

export type SourceIntent =
  | { op: 'addNode'; label: string; shape?: Shape }
  | { op: 'addNext'; anchor: string; label: string; shape: Shape; edgeLabel?: string; incoming: boolean }
  | { op: 'setNodeLabel' | 'setEdgeLabel'; sourceId: string; label: string }
  | { op: 'addEdge'; from: string; to: string; label?: string; direction?: ConnectionDirection }
  | { op: 'addGroup'; members: readonly string[]; label: string }
  | { op: 'removeGroup'; sourceId: string }
  | { op: 'removeGroupContents'; sourceId: string; members: readonly string[]; incidentEdgeIds: readonly string[] }
  | { op: 'moveToGroup'; sourceId: string; groupId: string }
  | { op: 'removeNode'; sourceId: string; incidentEdgeIds: readonly string[] }
  | { op: 'removeEdges'; sourceIds: readonly string[] }
  | { op: 'removeEdge'; sourceId: string };

const directionsByEngineType = new Map(Object.entries(flowchartEngineConnections).map(([direction, type]) => [type, direction]));
const shapesByEngineType = new Map(Object.entries(flowchartEngineShapes).map(([shape, type]) => [type, shape]));
const mismatch = () => new Error('Mermaid read a different diagram than expected. Your source edit was not applied.');
const inexactLabel = () => new Error('Mermaid could not display that label exactly. Choose a different label and preview again.');

function readModel(model: FlowModel | undefined, allowGroup = false) {
  if (!model || (!allowGroup && model.groups.length) || model.classCount !== 0) throw mismatch();
  const groups = model.groups.map(group => ({ id: group.id, label: group.title ?? null, members: [...group.nodes].sort() }));
  const groupIds = new Set(groups.map(group => group.id));
  return {
    direction: model.direction ?? null,
    groups,
    nodes: Array.from(model.vertices.values()).filter(node => !groupIds.has(node.id)).map(node => ({
      id: node.id, shape: shapesByEngineType.get(node.type ?? '') ?? null,
      label: node.text ?? null, labelType: node.labelType ?? null,
      styles: node.styles ?? [], classes: node.classes ?? [],
    })),
    edges: model.edges.map(edge => ({
      id: edge.isUserDefinedId ? edge.id ?? null : null,
      from: edge.start, to: edge.end, label: edge.text ?? '', labelType: edge.labelType ?? null,
      type: edge.type ?? null, stroke: edge.stroke ?? null, length: edge.length ?? null,
      interpolate: edge.interpolate ?? null, styles: edge.style ?? [], classes: edge.classes ?? [],
    })),
    defaultStyle: model.defaultStyle ?? [],
    defaultInterpolate: model.defaultInterpolate ?? null,
  };
}

type SemanticGraph = ReturnType<typeof readModel>;

function planSourceEdit(source: string, intent: SourceIntent): {
  sourceId: string; patches: SourcePatch[]; edgeId?: string; from?: string; to?: string; memberIds?: string[]; flatSource?: string;
  afterGroupRemoval?: SourcePatch[];
} {
  switch (intent.op) {
    case 'addNode': return planNodeAddition(source, intent.label, intent.shape);
    case 'addNext': return planAddNext(source, intent.anchor, intent.label, intent.shape, intent.edgeLabel, intent.incoming);
    case 'addEdge': return planEdgeAddition(source, intent.from, intent.to, intent.label, intent.direction);
    case 'addGroup': return planGroupCreation(source, intent.members, intent.label);
    case 'removeGroup': return planGroupRemoval(source, intent.sourceId);
    case 'removeGroupContents': return planGroupContentsRemoval(source, intent.sourceId, intent.members, intent.incidentEdgeIds);
    case 'moveToGroup': return planMoveToGroup(source, intent.sourceId, intent.groupId);
    case 'removeNode': return { sourceId: intent.sourceId, patches: planNodeRemoval(source, intent.sourceId, intent.incidentEdgeIds) };
    case 'removeEdge': return { sourceId: intent.sourceId, patches: planEdgeRemoval(source, intent.sourceId) };
    case 'removeEdges': return { sourceId: intent.sourceIds[0], patches: planEdgeSelectionRemoval(source, intent.sourceIds) };
    case 'setEdgeLabel': return { sourceId: intent.sourceId, patches: planEdgeLabel(source, intent.sourceId, intent.label) };
    case 'setNodeLabel': return { sourceId: intent.sourceId, patches: planNodeLabel(source, intent.sourceId, intent.label) };
  }
}

function expectedEdit(graph: SemanticGraph, intent: Exclude<SourceIntent, { op: 'addNext' }>, sourceId: string, changed: boolean): SemanticGraph {
  switch (intent.op) {
    case 'addNode': return {
      ...graph,
      nodes: [...graph.nodes, { id: sourceId, shape: intent.shape ?? 'rect', label: intent.label, labelType: 'string', styles: [], classes: [] }],
    };
    case 'setNodeLabel': return {
      ...graph,
      nodes: graph.nodes.map(node => node.id === sourceId
        ? { ...node, label: intent.label, labelType: changed ? 'string' : node.labelType }
        : node),
    };
    case 'setEdgeLabel': return {
      ...graph,
      edges: graph.edges.map(edge => edge.id === sourceId
        ? { ...edge, label: intent.label, labelType: changed ? (intent.label ? 'string' : 'text') : edge.labelType }
        : edge),
    };
    case 'addEdge': return {
      ...graph,
      edges: [...graph.edges, {
        id: sourceId, from: intent.from, to: intent.to,
        label: intent.label ?? '', labelType: intent.label ? 'string' : 'text',
        type: flowchartEngineConnections[intent.direction ?? 'forward'], stroke: 'normal', length: 1, interpolate: null, styles: [], classes: [],
      }],
    };
    case 'addGroup':
      return { ...graph, groups: [{ id: sourceId, label: intent.label, members: [...intent.members].sort() }] };
    case 'removeGroup':
      return { ...graph, groups: [] };
    case 'moveToGroup':
      return { ...graph, groups: graph.groups.map(group => group.id === intent.groupId
        ? { ...group, members: [...group.members, sourceId].sort() } : group) };
    case 'removeEdge': return { ...graph, edges: graph.edges.filter(edge => edge.id !== sourceId) };
    case 'removeEdges': {
      const removed = new Set(intent.sourceIds);
      return { ...graph, edges: graph.edges.filter(edge => !edge.id || !removed.has(edge.id)) };
    }
    case 'removeNode':
    case 'removeGroupContents': {
      const removed = new Set(intent.incidentEdgeIds);
      const members = new Set(intent.op === 'removeGroupContents' ? intent.members : [sourceId]);
      return {
        ...graph,
        groups: intent.op === 'removeGroupContents' ? [] : graph.groups,
        nodes: graph.nodes.filter(node => !members.has(node.id)),
        edges: graph.edges.filter(edge => !edge.id || !removed.has(edge.id)),
      };
    }
  }
}

function verifyVisibleLabel(result: RenderResult, intent: Exclude<SourceIntent, { op: 'addNext' }>, id: string) {
  if ((intent.op === 'addEdge' && !intent.label) || intent.op === 'removeEdge' || intent.op === 'removeEdges'
    || intent.op === 'removeNode' || intent.op === 'removeGroup' || intent.op === 'removeGroupContents' || intent.op === 'moveToGroup') return;
  const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  if (intent.op === 'addGroup') {
    const clusters = Array.from(svg.querySelectorAll('g.cluster[data-element-key]'))
      .filter(cluster => cluster.getAttribute('data-element-key') === `group:${id}`);
    if (clusters.length !== 1 || clusters[0].querySelector('.cluster-label')?.textContent !== intent.label) throw inexactLabel();
    return;
  }
  const edge = intent.op === 'addEdge' || intent.op === 'setEdgeLabel';
  const targets = edge ? svg.querySelectorAll('g.edgeLabel[data-element-owner]') : svg.querySelectorAll('[data-node-key]');
  const attribute = edge ? 'data-element-owner' : 'data-node-key';
  const key = edge ? `edge:id:${id}` : id;
  const matching = Array.from(targets).filter(target => target.getAttribute(attribute) === key);
  if (edge && !intent.label && !matching.length) return;
  if (matching.length !== 1 || matching[0].textContent !== intent.label) throw inexactLabel();
}

function semanticTopology(graph: SemanticGraph) {
  return {
    direction: graph.direction,
    nodes: graph.nodes.map(({ id, shape }) => ({ id, shape })),
    edges: graph.edges.map(({ id, from, to, type }) => ({ id, from, to, direction: directionsByEngineType.get(type ?? '') ?? null })),
  };
}

const byId = (left: { id: string }, right: { id: string }) => left.id.localeCompare(right.id);

function verifySourceTopology(
  before: SemanticGraph, expected: ReturnType<typeof flowchartSubsetTopology>, groups?: ReadonlyMap<string, string[]>,
) {
  const topology = semanticTopology(before);
  if (groups?.size) {
    const declared = Array.from(groups, ([id, members]) => ({ id, members: [...members].sort() })).sort(byId);
    const observed = before.groups.map(({ id, members }) => ({ id, members })).sort(byId);
    if (canonicalJson(declared) !== canonicalJson(observed)) throw mismatch();
    topology.nodes.sort(byId);
    expected = { ...expected, nodes: [...expected.nodes].sort(byId) };
  }
  if (canonicalJson(topology) !== canonicalJson(expected)) throw mismatch();
}

/** Compare the complete parser graph and all new visible labels in one serialized render. */
export async function proveFlowchartFragment(
  document: Pick<StudioDocument, 'source' | 'settings'>, fragment: FlowchartFragment, signal?: AbortSignal,
) {
  const plan = planFlowchartFragment(document.source, fragment);
  const source = applySourcePatches(document.source, plan.patches);
  const render = (text: string) => renderDiagram(text, document.settings, {}, undefined, { signal });
  const current = await render(document.source);
  const before = readModel(flowchartModelFor(current), !!plan.existingGroups.size);
  verifySourceTopology(before, plan.topology, plan.existingGroups);
  const rendered = await render(source);
  const grouped = !!(plan.existingGroups.size || plan.groups.length);
  const actual = readModel(flowchartModelFor(rendered), grouped);
  let expected = before;
  for (const item of plan.nodes) {
    expected = expectedEdit(expected, { op: 'addNode', label: item.label, shape: item.shape }, item.sourceId, true);
  }
  for (const item of plan.edges) {
    expected = expectedEdit(expected, { op: 'addEdge', from: item.from, to: item.to, label: item.label, direction: item.direction }, item.sourceId, true);
  }
  if (grouped) {
    expected = { ...expected, groups: [...before.groups, ...plan.groups.map(({ sourceId, label, members }) =>
      ({ id: sourceId, label, members: [...members].sort() }))] };
    for (const graph of [actual, expected]) {
      graph.groups.sort(byId);
      graph.nodes.sort(byId);
    }
  }
  if (canonicalJson(actual) !== canonicalJson(expected)) throw mismatch();
  const svg = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
  const nodeLabels = new Map(Array.from(svg.querySelectorAll('[data-node-key]'),
    item => [item.getAttribute('data-node-key'), item.textContent]));
  const edgeLabels = new Map(Array.from(svg.querySelectorAll('g.edgeLabel[data-element-owner]'),
    item => [item.getAttribute('data-element-owner'), item.textContent]));
  const groupLabels = new Map(Array.from(svg.querySelectorAll('[data-element-kind="group"]'), item =>
    [item.getAttribute('data-element-key'), item.querySelector('.cluster-label')?.textContent]));
  if (plan.nodes.some(item => nodeLabels.get(item.sourceId) !== item.label)
    || plan.edges.some(item => item.label && edgeLabels.get(`edge:id:${item.sourceId}`) !== item.label)
    || plan.groups.some(item => groupLabels.get(`group:${item.sourceId}`) !== item.label)) throw inexactLabel();
  return { ...plan, source, rendered };
}

/**
 * Prove one narrow edit against the real serialized Mermaid renderer. Only the
 * expected source-semantic delta and exact visible label may change.
 */
export async function proveFlowchartEdit(
  document: Pick<StudioDocument, 'source' | 'settings'> & Partial<Pick<StudioDocument, 'nodeAccents' | 'design'>>,
  intent: SourceIntent,
  signal?: AbortSignal,
) {
  const plan = planSourceEdit(document.source, intent);
  const patched = applySourcePatches(document.source, plan.patches);
  const source = plan.afterGroupRemoval ? applySourcePatches(patched, plan.afterGroupRemoval) : patched;
  const groupId = intent.op === 'removeGroup' || intent.op === 'removeGroupContents' ? intent.sourceId
    : intent.op === 'moveToGroup' ? intent.groupId : undefined;
  const renaming = intent.op === 'setNodeLabel' || intent.op === 'setEdgeLabel';
  const groupedSource = renaming ? groupedFlowchartTopology(document.source) : undefined;
  const sourceTopology = groupedSource?.topology ?? flowchartSubsetTopology(plan.flatSource ?? document.source);
  const groupedRename = !!groupedSource?.groups.size;
  const render = (text: string) => renderDiagram(text, document.settings, document.nodeAccents ?? {}, document.design, { signal });
  const initial = await render(document.source);
  const before = readModel(flowchartModelFor(initial), !!groupId || groupedRename);
  if (groupId && (before.groups.length !== 1 || before.groups[0].id !== groupId
    || canonicalJson(before.groups[0].members) !== canonicalJson(plan.memberIds?.sort()))) throw mismatch();
  verifySourceTopology(before, sourceTopology, groupedSource?.groups);
  const output = source === document.source ? initial : await render(source);
  const actual = readModel(flowchartModelFor(output), groupedRename || intent.op === 'addGroup' || intent.op === 'moveToGroup');
  let expected: SemanticGraph;
  let addedEdgeId: string | undefined;
  if (intent.op === 'addNext') {
    if (!plan.edgeId || !plan.from || !plan.to) throw mismatch();
    const node = { op: 'addNode', label: intent.label, shape: intent.shape } as const;
    const edge = { op: 'addEdge', from: plan.from, to: plan.to, label: intent.edgeLabel } as const;
    verifyVisibleLabel(output, node, plan.sourceId);
    verifyVisibleLabel(output, edge, plan.edgeId);
    expected = expectedEdit(expectedEdit(before, node, plan.sourceId, true), edge, plan.edgeId, true);
    addedEdgeId = plan.edgeId;
  } else {
    verifyVisibleLabel(output, intent, plan.sourceId);
    expected = expectedEdit(before, intent, plan.sourceId, source !== document.source);
  }
  const orderNodes = (graph: SemanticGraph) => intent.op === 'moveToGroup'
    ? { ...graph, nodes: [...graph.nodes].sort(byId) } : graph;
  if (canonicalJson(orderNodes(actual)) !== canonicalJson(orderNodes(expected))) throw mismatch();
  return { source, sourceId: plan.sourceId, render: output, addedEdgeId };
}
