import { projectBaseToken, sameBaseToken } from './base-token';
import { validateComponentDefinition, type ComponentDefinition } from './component-definition';
import type { MermaidProjectV3 } from './mermaid-project';
import type { renderMermaidProject } from './project-render';
import { flowchartSubsetTopology } from './source-patches';

type RenderedProject = Awaited<ReturnType<typeof renderMermaidProject>>;
type Node = ComponentDefinition['fragment']['nodes'][number];
type Edge = ComponentDefinition['fragment']['edges'][number];
type Port = ComponentDefinition['ports'][number];

export async function readComponentSelection(document: MermaidProjectV3, frame: RenderedProject, selected: ReadonlySet<string>) {
  const table = frame.targetTable;
  const token = await projectBaseToken(document);
  if (!table || !frame.edgeLabels || !sameBaseToken(token, table.baseToken)) {
    throw new Error('Open a current verified diagram before saving a component.');
  }
  const topology = flowchartSubsetTopology(document.source);
  const shapes = new Map(topology.nodes.map(item => [item.id, item.shape]));
  const bindings = new Map(document.identity.elements
    .filter(item => item.status === 'resolved').map(item => [item.id, item.binding.sourceId]));
  const role = new Map(document.roles.map(item => [item.elementId, item.role]));
  const names = new Map(table.targets.map(item => [item.id, item.label]));
  const chosen = table.targets.filter(item => item.elementKind === 'node' && selected.has(item.id));
  if (!chosen.length || chosen.length > 100 || chosen.length !== selected.size) {
    throw new Error('Select between one and 100 current nodes. Connections are reviewed separately.');
  }
  const local = new Map(chosen.map((item, index) => [item.id, `node-${index + 1}`]));
  const nodes: Node[] = chosen.map(item => {
    const shape = shapes.get(bindings.get(item.id) ?? '');
    if (!shape || !item.label.trim()) throw new Error('Each selected node needs a verified source shape and a nonempty label.');
    return { id: local.get(item.id)!, label: item.label, shape, role: role.get(item.id) ?? null };
  });
  const edges: (Edge & { summary: string })[] = [];
  const boundaries: (Port & { summary: string })[] = [];
  for (const item of table.targets) {
    if (item.elementKind !== 'edge' || !item.sourceId || !item.targetId) continue;
    const from = local.get(item.sourceId);
    const to = local.get(item.targetId);
    if (!from && !to) continue;
    const label = frame.edgeLabels.get(item.id);
    if (label === undefined || item.direction !== 'forward') throw new Error('A selected connection needs a verified authored label and direction.');
    const summary = `${names.get(item.sourceId)} → ${names.get(item.targetId)}${label ? ` · ${label}` : ''}`;
    if (from && to) {
      edges.push({ id: `edge-${edges.length + 1}`, sourceId: from, targetId: to, label, direction: 'forward', summary });
    } else {
      boundaries.push({
        id: `port-${boundaries.length + 1}`,
        nodeId: from ?? to!,
        label: (from ? 'Output ' : 'Input ') + (boundaries.length + 1),
        direction: from ? 'out' : 'in',
        summary,
      });
    }
  }
  return { nodes, edges, boundaries };
}

type Selection = Awaited<ReturnType<typeof readComponentSelection>>;
export function componentFromSelection(
  selection: Selection, id: string, name: string, includedEdges: ReadonlySet<string>, includedPorts: ReadonlyMap<string, string>,
  parameterNodes: ReadonlySet<string>,
) {
  const edges = selection.edges.flatMap(({ summary: _summary, ...edge }) => includedEdges.has(edge.id) ? [edge] : []);
  const ports = selection.boundaries.flatMap(({ summary: _summary, ...port }) => {
    const label = includedPorts.get(port.id);
    return label === undefined ? [] : [{ ...port, label }];
  });
  const parameters: ComponentDefinition['parameters'] = [];
  const labelBindings: ComponentDefinition['labelBindings'] = [];
  for (const node of selection.nodes) {
    if (!parameterNodes.has(node.id)) continue;
    const parameterId = `label-${node.id}`;
    parameters.push({ id: parameterId, type: 'text', label: `Label for ${node.id.replace('-', ' ')}`,
      required: true, default: node.label, maxLength: 200 });
    labelBindings.push({ nodeId: node.id, parameterId, prefix: '', suffix: '' });
  }
  if (!name.trim()) throw new Error('Enter a name for this component.');
  if (edges.length !== includedEdges.size || edges.length > 200) throw new Error('Review up to 200 current internal connections.');
  if (ports.length !== includedPorts.size || ports.length > 16) throw new Error('Review up to 16 current attachment ports.');
  if (parameters.length !== parameterNodes.size || parameters.length > 32) throw new Error('Choose up to 32 current labels as parameters.');
  return validateComponentDefinition({
    id, name: name.trim(), schema: 'meridian-component/v1', version: '1.0.0', family: 'flowchart', description: '', tags: [],
    provenance: { author: '', source: 'Created from a Meridian selection', license: '', licenseText: '' },
    fragment: { nodes: selection.nodes, edges, groups: [] }, parameters, labelBindings, ports,
  });
}
