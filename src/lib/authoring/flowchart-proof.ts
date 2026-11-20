import type { RenderResult, StudioDocument } from '../../types';
import type { FlowModel } from '../design';
import { flowchartModelFor, renderDiagram } from '../render';
import { canonicalJson } from './base-token';
import { flowchartEngineShapes, type Shape } from './flowchart-source';
import { applySourcePatches, flowchartSubsetTopology, planAddNext, planEdgeAddition, planEdgeLabel, planEdgeRemoval, planGroupCreation, planGroupRemoval, planNodeAddition, planNodeLabel, planNodeRemoval, type SourcePatch } from './source-patches';

export type SourceIntent =
  | { op: 'addNode'; label: string; shape?: Shape }
  | { op: 'addNext'; anchor: string; label: string; shape: Shape; edgeLabel?: string; incoming: boolean }
  | { op: 'setNodeLabel' | 'setEdgeLabel'; sourceId: string; label: string }
  | { op: 'addEdge'; from: string; to: string; label?: string }
  | { op: 'addGroup'; members: readonly string[]; label: string }
  | { op: 'removeGroup'; sourceId: string }
  | { op: 'removeNode'; sourceId: string; incidentEdgeIds: readonly string[] }
  | { op: 'removeEdge'; sourceId: string };

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

function planSourceEdit(source: string, intent: SourceIntent): { sourceId: string; patches: SourcePatch[]; edgeId?: string; from?: string; to?: string; memberIds?: string[] } {
  switch (intent.op) {
    case 'addNode': return planNodeAddition(source, intent.label, intent.shape);
    case 'addNext': return planAddNext(source, intent.anchor, intent.label, intent.shape, intent.edgeLabel, intent.incoming);
    case 'addEdge': return planEdgeAddition(source, intent.from, intent.to, intent.label);
    case 'addGroup': return planGroupCreation(source, intent.members, intent.label);
    case 'removeGroup': return planGroupRemoval(source, intent.sourceId);
    case 'removeNode': return { sourceId: intent.sourceId, patches: planNodeRemoval(source, intent.sourceId, intent.incidentEdgeIds) };
    case 'removeEdge': return { sourceId: intent.sourceId, patches: planEdgeRemoval(source, intent.sourceId) };
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
        type: 'arrow_point', stroke: 'normal', length: 1, interpolate: null, styles: [], classes: [],
      }],
    };
    case 'addGroup':
      return { ...graph, groups: [{ id: sourceId, label: intent.label, members: [...intent.members].sort() }] };
    case 'removeGroup':
      return { ...graph, groups: [] };
    case 'removeEdge': return { ...graph, edges: graph.edges.filter(edge => edge.id !== sourceId) };
    case 'removeNode': {
      const removed = new Set(intent.incidentEdgeIds);
      return {
        ...graph,
        nodes: graph.nodes.filter(node => node.id !== sourceId),
        edges: graph.edges.filter(edge => !edge.id || !removed.has(edge.id)),
      };
    }
  }
}

function verifyVisibleLabel(result: RenderResult, intent: Exclude<SourceIntent, { op: 'addNext' }>, id: string) {
  if ((intent.op === 'addEdge' && !intent.label) || intent.op === 'removeEdge' || intent.op === 'removeNode' || intent.op === 'removeGroup') return;
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
  const source = applySourcePatches(document.source, plan.patches);
  const removingGroup = intent.op === 'removeGroup';
  const sourceTopology = flowchartSubsetTopology(removingGroup ? source : document.source);
  const render = (text: string) => renderDiagram(text, document.settings, document.nodeAccents ?? {}, document.design, { signal });
  const initial = await render(document.source);
  const before = readModel(flowchartModelFor(initial), removingGroup);
  if (removingGroup && (before.groups.length !== 1 || before.groups[0].id !== intent.sourceId
    || canonicalJson(before.groups[0].members) !== canonicalJson(plan.memberIds?.sort()))) throw mismatch();
  const observedTopology = {
    direction: before.direction,
    nodes: before.nodes.map(({ id, shape }) => ({ id, shape })),
    edges: before.edges.map(({ id, from, to }) => ({ id, from, to })),
  };
  if (canonicalJson(sourceTopology) !== canonicalJson(observedTopology)) throw mismatch();
  const output = source === document.source ? initial : await render(source);
  const actual = readModel(flowchartModelFor(output), intent.op === 'addGroup');
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
  if (canonicalJson(actual) !== canonicalJson(expected)) throw mismatch();
  return { source, sourceId: plan.sourceId, render: output, addedEdgeId };
}
