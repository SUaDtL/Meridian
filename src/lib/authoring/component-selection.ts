import { projectBaseToken, sameBaseToken } from './base-token';
import { validateComponentDefinition, type ComponentDefinition } from './component-definition';
import type { MermaidProjectV3 } from './mermaid-project';
import type { renderMermaidProject } from './project-render';
import { componentSelectionTopology } from './source-patches';

type RenderedProject = Awaited<ReturnType<typeof renderMermaidProject>>;
type Node = ComponentDefinition['fragment']['nodes'][number];
type Edge = ComponentDefinition['fragment']['edges'][number];
type Group = ComponentDefinition['fragment']['groups'][number];
type Port = ComponentDefinition['ports'][number];
const connectors = { forward: '→', both: '↔', none: '–' } as const;

export async function readComponentSelection(document: MermaidProjectV3, frame: RenderedProject, selected: ReadonlySet<string>) {
  const table = frame.targetTable;
  const token = await projectBaseToken(document);
  if (!table || !frame.edgeLabels || !sameBaseToken(token, table.baseToken)) {
    throw new Error('Open a current verified diagram before saving a component.');
  }
  const topology = componentSelectionTopology(document.source);
  const shapes = new Map(topology.nodes.map(item => [item.id, item.shape]));
  const bindings = new Map(document.identity.elements
    .filter(item => item.status === 'resolved').map(item => [item.id, item.binding.sourceId]));
  const role = new Map(document.roles.map(item => [item.elementId, item.role]));
  const targets = new Map(table.targets.map(item => [item.id, item]));
  if (!selected.size || selected.size > 100 || [...selected].some(id => {
    const item = targets.get(id);
    return !item || item.elementKind === 'edge';
  })) {
    throw new Error('Select up to 100 current nodes or groups. Connections are reviewed separately.');
  }
  const included = new Set(selected);
  const fullGroups = new Set<string>();
  const pending = [...selected];
  for (let index = 0; index < pending.length; index++) {
    const item = targets.get(pending[index]);
    if (!item) throw new Error('A selected group member could not be verified.');
    if (item.elementKind !== 'group' || fullGroups.has(item.id)) continue;
    fullGroups.add(item.id);
    for (const member of item.members) {
      included.add(member);
      pending.push(member);
    }
  }
  for (const id of included) {
    const parent = targets.get(id)?.parentId;
    if (parent) included.add(parent);
  }
  const chosen = table.targets.filter(item => item.elementKind === 'node' && included.has(item.id));
  const containers = table.targets.filter(item => item.elementKind === 'group' && included.has(item.id));
  if (!chosen.length || chosen.length > 100 || containers.length > 10) {
    throw new Error('Review a component with 1 to 100 nodes and up to 10 groups.');
  }
  const local = new Map([
    ...chosen.map((item, index) => [item.id, `node-${index + 1}`] as const),
    ...containers.map((item, index) => [item.id, `group-${index + 1}`] as const),
  ]);
  const nodes: Node[] = chosen.map(item => {
    const shape = shapes.get(bindings.get(item.id) ?? '');
    if (!shape || !item.label.trim()) throw new Error('Each selected node needs a verified source shape and a nonempty label.');
    return { id: local.get(item.id)!, label: item.label, shape, role: role.get(item.id) ?? null };
  });
  const groups: Group[] = containers.map(item => {
    const sourceMembers = topology.groups.get(bindings.get(item.id) ?? '');
    const observed = new Set(item.members.map(id => bindings.get(id)));
    const members = item.members.flatMap(id => local.has(id) ? [local.get(id)!] : []);
    if (!sourceMembers || sourceMembers.length !== observed.size || sourceMembers.some(id => !observed.has(id))
      || !members.length || !item.label.trim()) {
      throw new Error('Each component group needs verified membership and a nonempty label.');
    }
    return { id: local.get(item.id)!, label: item.label, members,
      parentId: item.parentId ? local.get(item.parentId) ?? null : null };
  });
  const edges: (Edge & { summary: string })[] = [];
  const boundaries: (Port & { summary: string })[] = [];
  for (const item of table.targets) {
    if (item.elementKind !== 'edge' || !item.sourceId || !item.targetId) continue;
    const from = local.get(item.sourceId);
    const to = local.get(item.targetId);
    if (!from && !to) continue;
    const label = frame.edgeLabels.get(item.id);
    const direction = item.direction;
    if (label === undefined || !direction) throw new Error('A selected connection needs a verified authored label and direction.');
    const source = targets.get(item.sourceId)!;
    const target = targets.get(item.targetId)!;
    const summary = `${source.label} ${connectors[direction]} ${target.label}${label ? ` · ${label}` : ''}`;
    if (from && to) {
      if ([source, target].some(endpoint => endpoint.elementKind === 'group' && !fullGroups.has(endpoint.id))) {
        throw new Error(`Select the whole group to include its connection ${summary}.`);
      }
      edges.push({ id: `edge-${edges.length + 1}`, sourceId: from, targetId: to, label, direction, summary });
    } else {
      if ((from ? source : target).elementKind === 'group') {
        throw new Error(`The boundary connection ${summary} attaches to a group. Select both endpoints to keep the connection inside the component.`);
      }
      if (direction !== 'forward') throw new Error(`The boundary connection ${summary} cannot be represented as a directed port. Select both endpoints to keep it inside the component.`);
      boundaries.push({
        id: `port-${boundaries.length + 1}`,
        nodeId: from ?? to!,
        label: (from ? 'Output ' : 'Input ') + (boundaries.length + 1),
        direction: from ? 'out' : 'in',
        summary,
      });
    }
  }
  return { nodes, groups, edges, boundaries };
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
    fragment: { nodes: selection.nodes, edges, groups: selection.groups }, parameters, labelBindings, ports,
  });
}
