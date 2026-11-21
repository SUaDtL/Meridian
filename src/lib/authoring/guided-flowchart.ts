import { flowchartModelFor, renderDiagram } from '../render';
import { createDocument } from '../storage';
import { flowchartEngineConnections, flowchartEngineShapes, verifyNodeLabels, writeFlowchart, type FlowchartInput } from './flowchart-source';
import type { SemanticRole } from './mermaid-project';
import { migrateLegacyProject } from './migrate-legacy-project';
import { validateMermaidProject } from './validate-mermaid-project';

type GuidedFlowchart = Omit<FlowchartInput, 'nodes'> & { nodes: readonly (FlowchartInput['nodes'][number] & { role?: SemanticRole | null })[] };

export async function prepareGuidedFlowchart(title: string, input: GuidedFlowchart, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { nodes, edges } = input;
  const groups = input.groups ?? [];
  const generated = writeFlowchart(input);
  const candidate = { ...createDocument(), title, source: generated.source };
  const rendered = await renderDiagram(candidate.source, candidate.settings, candidate.nodeAccents, candidate.design, { signal, priority: 'preview' });
  const model = flowchartModelFor(rendered);
  const expectedGroups = new Set(generated.groupIds.values());
  const endpoints = new Map([...generated.nodeIds, ...generated.groupIds]);
  if (!model || model.groups.length !== groups.length || model.direction !== input.direction
      || [...model.vertices.keys()].filter(id => !expectedGroups.has(id)).length !== nodes.length || model.edges.length !== edges.length
      || nodes.some(node => model.vertices.get(generated.nodeIds.get(node.key) ?? '')?.type !== flowchartEngineShapes[node.shape ?? 'rect'])
      || model.edges.some((edge, index) => !edge.isUserDefinedId || edge.id !== generated.edgeIds[index]
        || edge.start !== endpoints.get(edges[index].from)
        || edge.end !== endpoints.get(edges[index].to) || edge.type !== flowchartEngineConnections[edges[index].direction ?? 'forward']
        || (edge.text ?? '') !== (edges[index].label ?? ''))) {
    throw new Error('The renderer did not preserve the reviewed diagram connections.');
  }
  const byGroup = new Map(model.groups.map(group => [group.id, group]));
  for (const group of groups) {
    const actual = byGroup.get(generated.groupIds.get(group.key)!);
    const members = new Set(group.members.map(key => endpoints.get(key)));
    if (!actual || actual.nodes.length !== members.size || actual.nodes.some(id => !members.delete(id))) {
      throw new Error('The renderer did not preserve the reviewed group membership.');
    }
  }
  const diagram = new DOMParser().parseFromString(rendered.svg, 'image/svg+xml');
  const labels = new Map(Array.from(diagram.querySelectorAll('[data-node-key]'),
    element => [element.getAttribute('data-node-key')!, element.textContent ?? '']));
  verifyNodeLabels(input, generated, labels);
  if (groups.length) {
    const groupLabels = new Map(Array.from(diagram.querySelectorAll('[data-element-kind="group"]'), element =>
      [element.getAttribute('data-element-key'), element.querySelector('.cluster-label')?.textContent ?? '']));
    for (const group of groups) {
      if (groupLabels.get(`group:${generated.groupIds.get(group.key)}`) !== group.label) {
        throw new Error('The renderer could not display the reviewed group label exactly.');
      }
    }
  }
  const edgeLabels = new Map(Array.from(diagram.querySelectorAll('g.edgeLabel[data-element-owner]'),
    element => [element.getAttribute('data-element-owner')!, element.textContent ?? '']));
  for (const [index, edge] of edges.entries()) {
    if (edge.label && edgeLabels.get(`edge:id:${generated.edgeIds[index]}`) !== edge.label) {
      throw new Error(`The renderer could not display connection ${index + 1}'s label exactly. Change that label and preview again.`);
    }
  }
  const migrated = await migrateLegacyProject(candidate, { status: 'verified', model });
  signal?.throwIfAborted();
  if (migrated.status !== 'migrated') throw new Error('The diagram does not fit the limits of a portable project.');
  const bound = new Map(migrated.document.identity.elements.filter(record => record.elementKind === 'node')
    .map(record => [record.binding.sourceId, record.id]));
  const roles = nodes.flatMap(node => {
    if (!node.role) return [];
    const elementId = bound.get(generated.nodeIds.get(node.key) ?? '');
    if (!elementId) throw new Error('The renderer could not bind a role to its node.');
    return [{ elementId, role: node.role }];
  });
  return { document: roles.length ? validateMermaidProject({ ...migrated.document, roles }) : migrated.document, rendered, generated };
}
