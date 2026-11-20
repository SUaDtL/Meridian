import { flowchartModelFor, renderDiagram } from '../render';
import { createDocument } from '../storage';
import { verifyNodeLabels, writeFlowchart } from './flowchart-source';
import { migrateLegacyProject } from './migrate-legacy-project';
import { reviewedProcessGraph, type ProcessConnections } from './process-connections';

import type { ProcessStep } from './process-steps';
export type { ProcessStep } from './process-steps';

export async function prepareGuidedProcess(title: string, steps: readonly ProcessStep[], signal?: AbortSignal, connections?: ProcessConnections) {
  signal?.throwIfAborted();
  const input = reviewedProcessGraph(steps, connections);
  const { nodes, edges } = input;
  const generated = writeFlowchart(input);
  const candidate = { ...createDocument(), title: title.trim() || 'Untitled process', source: generated.source };
  const rendered = await renderDiagram(candidate.source, candidate.settings, candidate.nodeAccents, candidate.design, { signal });
  const model = flowchartModelFor(rendered);
  if (!model || model.groups.length || model.direction !== input.direction
      || model.vertices.size !== nodes.length || model.edges.length !== edges.length
      || nodes.some(node => model.vertices.get(generated.nodeIds.get(node.key) ?? '')?.type !== (node.shape === 'diamond' ? 'diamond' : 'square'))
      || model.edges.some((edge, index) => !edge.isUserDefinedId || edge.id !== generated.edgeIds[index]
        || edge.start !== generated.nodeIds.get(edges[index].from)
        || edge.end !== generated.nodeIds.get(edges[index].to) || edge.type !== 'arrow_point'
        || (edge.text ?? '') !== (edges[index].label ?? ''))) {
    throw new Error('The renderer did not preserve the reviewed process connections.');
  }
  const diagram = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
  const labels = new Map(Array.from(diagram.querySelectorAll('[data-node-key]'),
    element => [element.getAttribute('data-node-key')!, element.textContent ?? '']));
  verifyNodeLabels(input, generated, labels);
  const edgeLabels = new Map(Array.from(diagram.querySelectorAll('g.edgeLabel[data-element-owner]'),
    element => [element.getAttribute('data-element-owner')!, element.textContent ?? '']));
  for (const [index, edge] of edges.entries()) {
    if (edge.label && edgeLabels.get(`edge:id:${generated.edgeIds[index]}`) !== edge.label) {
      throw new Error(`The renderer could not display connection ${index + 1}'s label exactly. Change that label and preview again.`);
    }
  }
  const migrated = await migrateLegacyProject(candidate, { status: 'verified', model });
  signal?.throwIfAborted();
  if (migrated.status !== 'migrated') throw new Error('The process does not fit the limits of a portable project.');
  return { document: migrated.document, rendered };
}
