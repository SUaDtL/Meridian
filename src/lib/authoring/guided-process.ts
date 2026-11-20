import { flowchartModelFor, renderDiagram } from '../render';
import { createDocument } from '../storage';
import { authoringLimits, verifyNodeLabels, writeFlowchart } from './flowchart-source';
import { migrateLegacyProject } from './migrate-legacy-project';

export interface ProcessStep {
  line: number;
  original: string;
  label: string;
}

export function normalizeProcessSteps(raw: string): ProcessStep[] {
  if (raw.length > authoringLimits.sourceCodeUnits) throw new Error('The process input is too large.');
  const steps: ProcessStep[] = [];
  raw.split(/\r\n|\n|\r/).forEach((original, index) => {
    const trimmed = original.trim();
    if (!trimmed) return;
    const label = trimmed.replace(/^(?:[-*•]|\d+\.) +/, '');
    if (Array.from(label).length > authoringLimits.labelCodePoints) throw new Error(`Shorten the label on line ${index + 1} to at most 200 characters.`);
    steps.push({ line: index + 1, original, label });
  });
  if (!steps.length || steps.length > authoringLimits.graphNodes) throw new Error('Enter between 1 and 200 process steps.');
  return steps;
}

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
