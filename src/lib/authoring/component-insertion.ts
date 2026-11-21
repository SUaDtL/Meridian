import { canonicalDigest } from './base-token';
import { validateComponentDefinition, type ComponentDefinition } from './component-definition';
import { materializeComponent } from './component-project';
import type { MermaidProjectV3 } from './mermaid-project';
import { prepareProjectFragment } from './project-fragment';
import type { FlowchartFragment } from './source-patches';
import { validateMermaidProject } from './validate-mermaid-project';

export type PortAssignment = { targetId: string; direction: 'in' | 'out' } | null;

export async function prepareComponentInsertion(
  base: MermaidProjectV3, definition: ComponentDefinition, values: Readonly<Record<string, string | number>>,
  assignments: ReadonlyMap<string, PortAssignment>, signal?: AbortSignal,
) {
  if (base.componentInstances.length >= 100) throw new Error('This project already has 100 component instances.');
  const component = structuredClone(validateComponentDefinition(definition));
  const ports = component.ports;
  if (assignments.size !== ports.length || ports.some(port => !assignments.has(port.id))) {
    throw new Error('Choose a connection or Leave unconnected for every port.');
  }
  const currentNodes = new Map(base.identity.elements.filter(item => item.elementKind === 'node' && item.status === 'resolved')
    .map(item => [item.id, item.binding.sourceId]));
  const graph = materializeComponent(component, values);
  const edges: FlowchartFragment['edges'][number][] = graph.edges.map((item, index) => ({
    key: component.fragment.edges[index].id,
    from: { key: item.from }, to: { key: item.to }, label: item.label, direction: item.direction,
  }));
  for (const port of ports) {
    const choice = assignments.get(port.id);
    if (!choice) continue;
    const sourceId = currentNodes.get(choice.targetId);
    if (!sourceId || (choice.direction !== 'in' && choice.direction !== 'out')
        || (port.direction !== 'either' && port.direction !== choice.direction)) {
      throw new Error('Choose a current attachment node and a direction allowed by the port.');
    }
    const inside = { key: port.nodeId };
    const outside = { current: sourceId };
    edges.push({ key: `attachment:${port.id}`,
      from: choice.direction === 'in' ? outside : inside, to: choice.direction === 'in' ? inside : outside, label: '',
    });
  }
  const definitionHash = await canonicalDigest('meridian-component/v1', [component]);
  signal?.throwIfAborted();
  const resolved = await prepareProjectFragment(base, { nodes: graph.nodes, edges, groups: graph.groups }, signal);
  const { bind } = resolved;
  const bindings = [...resolved.nodes, ...resolved.edges.slice(0, graph.edges.length), ...resolved.groups]
    .map(item => ({ localId: item.key, elementId: bind(item.sourceId) }));
  const roles = graph.nodes.flatMap((item, index) => item.role
    ? [{ elementId: bind(resolved.nodes[index].sourceId), role: item.role }] : []);
  const document = validateMermaidProject({
    ...base,
    source: resolved.source,
    revision: base.revision + 1,
    updatedAt: new Date().toISOString(),
    identity: { ...base.identity, elements: resolved.elements },
    roles: [...base.roles, ...roles],
    componentInstances: [...base.componentInstances, {
      id: crypto.randomUUID(), definitionId: component.id, definitionVersion: component.version, definitionHash, bindings,
    }],
  });
  return { document, definitionHash, graph, attachments: resolved.edges.length - graph.edges.length };
}
