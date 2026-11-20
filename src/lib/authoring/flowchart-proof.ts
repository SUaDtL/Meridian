import type { RenderResult, StudioDocument } from '../../types';
import type { FlowModel } from '../design';
import { flowchartModelFor, renderDiagram } from '../render';
import { canonicalJson } from './base-token';
import type { Shape } from './flowchart-source';
import { applySourcePatches, flowchartSubsetTopology, planEdgeAddition, planEdgeRemoval, planNodeAddition, planNodeLabel } from './source-patches';

export type SourceIntent =
  | { op: 'addNode'; label: string; shape?: Shape }
  | { op: 'setNodeLabel'; sourceId: string; label: string }
  | { op: 'addEdge'; from: string; to: string; label?: string }
  | { op: 'removeEdge'; sourceId: string };

const engineShape: Record<Shape, string> = {
  rect: 'square', rounded: 'round', stadium: 'stadium', diamond: 'diamond',
  circle: 'circle', cylinder: 'cylinder', hexagon: 'hexagon',
};
const shapesByEngineType = new Map(Object.entries(engineShape).map(([shape, type]) => [type, shape]));
const mismatch = () => new Error('Mermaid read a different diagram than expected. Your source edit was not applied.');
const inexactLabel = () => new Error('Mermaid could not display that label exactly. Choose a different label and preview again.');

function readModel(model: FlowModel | undefined) {
  if (!model || model.groups.length || model.classCount !== 0) throw mismatch();
  return {
    direction: model.direction ?? null,
    nodes: Array.from(model.vertices.values(), node => ({
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

function planSourceEdit(source: string, intent: SourceIntent) {
  switch (intent.op) {
    case 'addNode': return planNodeAddition(source, intent.label, intent.shape);
    case 'addEdge': return planEdgeAddition(source, intent.from, intent.to, intent.label);
    case 'removeEdge': return { sourceId: intent.sourceId, patches: planEdgeRemoval(source, intent.sourceId) };
    case 'setNodeLabel': return { sourceId: intent.sourceId, patches: planNodeLabel(source, intent.sourceId, intent.label) };
  }
}

function expectedEdit(graph: SemanticGraph, intent: SourceIntent, sourceId: string, changed: boolean): SemanticGraph {
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
    case 'addEdge': return {
      ...graph,
      edges: [...graph.edges, {
        id: sourceId, from: intent.from, to: intent.to,
        label: intent.label ?? '', labelType: intent.label ? 'string' : 'text',
        type: 'arrow_point', stroke: 'normal', length: 1, interpolate: null, styles: [], classes: [],
      }],
    };
    case 'removeEdge': return { ...graph, edges: graph.edges.filter(edge => edge.id !== sourceId) };
  }
}

function verifyVisibleLabel(result: RenderResult, intent: SourceIntent, id: string) {
  if ((intent.op === 'addEdge' && !intent.label) || intent.op === 'removeEdge') return;
  const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  const targets = intent.op === 'addEdge' ? svg.querySelectorAll('g.edgeLabel[data-element-owner]') : svg.querySelectorAll('[data-node-key]');
  const attribute = intent.op === 'addEdge' ? 'data-element-owner' : 'data-node-key';
  const key = intent.op === 'addEdge' ? `edge:id:${id}` : id;
  const matching = Array.from(targets).filter(target => target.getAttribute(attribute) === key);
  if (matching.length !== 1 || matching[0].textContent !== intent.label) throw inexactLabel();
}

/**
 * Prove one narrow edit against the real serialized Mermaid renderer. Only the
 * expected source-semantic delta and exact visible label may change.
 */
export async function proveFlowchartEdit(document: StudioDocument, intent: SourceIntent, signal?: AbortSignal) {
  const sourceTopology = flowchartSubsetTopology(document.source);
  const plan = planSourceEdit(document.source, intent);
  const source = applySourcePatches(document.source, plan.patches);
  const render = (text: string) => renderDiagram(text, document.settings, document.nodeAccents, document.design, { signal });
  const initial = await render(document.source);
  const before = readModel(flowchartModelFor(initial));
  const observedTopology = {
    direction: before.direction,
    nodes: before.nodes.map(({ id, shape }) => ({ id, shape })),
    edges: before.edges.map(({ id, from, to }) => ({ id, from, to })),
  };
  if (canonicalJson(sourceTopology) !== canonicalJson(observedTopology)) throw mismatch();
  const output = source === document.source ? initial : await render(source);
  const actual = readModel(flowchartModelFor(output));
  verifyVisibleLabel(output, intent, plan.sourceId);
  const expected = expectedEdit(before, intent, plan.sourceId, source !== document.source);
  if (canonicalJson(actual) !== canonicalJson(expected)) throw mismatch();
  return { source, sourceId: plan.sourceId, render: output };
}
