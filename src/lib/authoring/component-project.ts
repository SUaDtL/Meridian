import { canonicalDigest } from './base-token';
import { validateComponentDefinition, type ComponentDefinition } from './component-definition';
import { encodeMermaidLabel } from './flowchart-source';
import { prepareGuidedFlowchart } from './guided-flowchart';
import { validateMermaidProject } from './validate-mermaid-project';

export function materializeComponent(definition: ComponentDefinition, values: Readonly<Record<string, string | number>>) {
  const component = validateComponentDefinition(definition);
  const ids = new Set(component.parameters.map(parameter => parameter.id));
  if (Object.keys(values).some(id => !ids.has(id))) throw new Error('A value was supplied for an unknown component parameter.');
  const accepted = new Map(component.parameters.map(parameter => {
    const value = Object.hasOwn(values, parameter.id) ? values[parameter.id] : parameter.default;
    if (parameter.type === 'integer') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < parameter.minimum || value > parameter.maximum) {
        throw new Error(`Enter ${parameter.label} between ${parameter.minimum} and ${parameter.maximum}.`);
      }
    } else if (typeof value !== 'string' || (parameter.required && !value.trim())
      || (parameter.type === 'text' && [...value].length > parameter.maxLength)
      || (parameter.type === 'enum' && !parameter.choices.includes(value))) {
      throw new Error(`Choose a valid value for ${parameter.label}.`);
    }
    return [parameter.id, String(value)] as const;
  }));
  const byNode = new Map(component.labelBindings.map(binding => [binding.nodeId, binding]));
  const nodes = component.fragment.nodes.map(({ id, label, role, shape }) => {
    const binding = byNode.get(id);
    const next = binding ? `${binding.prefix}${accepted.get(binding.parameterId)!}${binding.suffix}` : label;
    if (/<\/?[a-z][^>]*>/i.test(next)) throw new Error('Component labels use plain text.');
    encodeMermaidLabel(next);
    return { key: id, label: next, role, shape };
  });
  return { nodes, edges: component.fragment.edges.map(edge => ({ from: edge.sourceId, to: edge.targetId, label: edge.label, direction: edge.direction })) };
}

export async function buildComponentProject(definition: ComponentDefinition, values: Readonly<Record<string, string | number>>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const component = structuredClone(validateComponentDefinition(definition));
  if (component.fragment.groups.length) {
    throw new Error('Component creation currently supports ungrouped fragments.');
  }
  const graph = materializeComponent(component, values);
  const definitionHash = await canonicalDigest('meridian-component/v1', [component]);
  const { document, rendered, generated } = await prepareGuidedFlowchart(component.name || 'Untitled component', { direction: 'LR', ...graph }, signal);
  signal?.throwIfAborted();
  const ids = new Map(document.identity.elements.map(record => [record.binding.sourceId, record.id]));
  const sourceIds = [...generated.nodeIds, ...component.fragment.edges.map((edge, index): [string, string] => [edge.id, generated.edgeIds[index]])];
  const bindings = sourceIds.map(([localId, sourceId]) => {
    const elementId = ids.get(sourceId);
    if (!elementId) throw new Error('The preview could not bind every component element.');
    return { localId, elementId };
  });
  const candidate = validateMermaidProject({ ...document,
    componentInstances: [{ id: crypto.randomUUID(), definitionId: component.id, definitionVersion: component.version, definitionHash, bindings }],
  });
  return { document: candidate, rendered, graph, definitionHash };
}
