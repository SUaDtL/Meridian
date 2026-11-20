import { flowchartModelFor, renderDiagram } from '../render';
import { createDocument } from '../storage';
import { verifyNodeLabels, writeFlowchart } from './flowchart-source';
import { migrateLegacyProject } from './migrate-legacy-project';

import type { ProcessStep } from './process-steps';
export type { ProcessStep } from './process-steps';

export async function prepareGuidedProcess(title: string, steps: readonly ProcessStep[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  const nodes = steps.map(step => ({ key: String(step.line), label: step.label }));
  const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index].key, to: node.key }));
  const input = { direction: 'LR' as const, nodes, edges };
  const generated = writeFlowchart(input);
  const candidate = { ...createDocument(), title: title.trim() || 'Untitled process', source: generated.source };
  const rendered = await renderDiagram(candidate.source, candidate.settings, candidate.nodeAccents, candidate.design, { signal });
  const model = flowchartModelFor(rendered);
  if (!model || model.groups.length || model.direction !== input.direction
      || model.vertices.size !== nodes.length || model.edges.length !== edges.length
      || model.edges.some((edge, index) => !edge.isUserDefinedId || edge.id !== generated.edgeIds[index]
        || edge.start !== generated.nodeIds.get(edges[index].from)
        || edge.end !== generated.nodeIds.get(edges[index].to) || edge.type !== 'arrow_point' || !!edge.text)) {
    throw new Error('The renderer did not preserve the reviewed process connections.');
  }
  const diagram = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
  const labels = new Map(Array.from(diagram.querySelectorAll('[data-node-key]'),
    element => [element.getAttribute('data-node-key')!, element.textContent ?? '']));
  verifyNodeLabels(input, generated, labels);
  const migrated = await migrateLegacyProject(candidate, { status: 'verified', model });
  signal?.throwIfAborted();
  if (migrated.status !== 'migrated') throw new Error('The process does not fit the limits of a portable project.');
  return { document: migrated.document, rendered };
}
