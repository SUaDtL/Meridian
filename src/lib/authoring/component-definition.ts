import { decodeJson } from './decode-json';
import { encodeMermaidLabel, type Shape } from './flowchart-source';
import type { SemanticRole } from './mermaid-project';
import { matchesBundledContract } from './validate-mermaid-project';
import schema from './schemas/component.schema.json';

type Parameter = { id: string; label: string; required: boolean } & (
  { type: 'text'; default: string; maxLength: number }
  | { type: 'enum'; default: string; choices: string[] }
  | { type: 'integer'; default: number; minimum: number; maximum: number }
);

export type ComponentDefinition = {
  schema: 'meridian-component/v1'; id: string; version: string; name: string; description: string; tags: string[]; family: 'flowchart';
  provenance: { author: string; license: string; licenseText: string; source: string };
  fragment: {
    nodes: { id: string; label: string; shape: Shape; role: SemanticRole | null }[];
    edges: { id: string; sourceId: string; targetId: string; label: string; direction: 'forward' | 'both' | 'none' }[];
    groups: { id: string; label: string; members: string[]; parentId: string | null }[];
  };
  parameters: Parameter[];
  labelBindings: { nodeId: string; parameterId: string; prefix: string; suffix: string }[];
  ports: { id: string; nodeId: string; label: string; direction: 'in' | 'out' | 'either' }[];
};

const maxComponentBytes = 200_000;
export const maxComponentLibraryBytes = 10_000_000;
const encoder = new TextEncoder();

export function serializeComponentLibrary(definitions: readonly ComponentDefinition[]) {
  return JSON.stringify({ schema: 'meridian-library/v1', definitions });
}

function literal(value: string) {
  if (/<\/?[a-z][^>]*>/i.test(value)) throw new Error('Component labels use plain text.');
  if (value) encodeMermaidLabel(value);
}

function uniquely<Thing extends { id: string }>(things: Thing[], message: string) {
  const byId = new Map(things.map(thing => [thing.id, thing]));
  if (byId.size !== things.length) throw new Error(message);
  return byId;
}

export function validateComponentDefinition(value: unknown): ComponentDefinition {
  if (!matchesBundledContract(value, schema)) throw new Error('This file does not match the Meridian component definition contract.');
  const component = value as ComponentDefinition;
  if (encoder.encode(JSON.stringify(component)).byteLength > maxComponentBytes) throw new Error('A component definition can use at most 200,000 bytes.');
  const { nodes, groups, edges } = component.fragment;
  const byNode = uniquely(nodes, 'Each component node needs a distinct local ID.');
  const byGroup = uniquely(groups, 'Each component group needs a distinct local ID.');
  const targets = uniquely([...nodes, ...groups], 'Component nodes and groups must have distinct local IDs.');
  uniquely([...nodes, ...groups, ...edges], 'Component nodes, groups and connections must have distinct local IDs.');
  for (const node of nodes) literal(node.label);
  for (const edge of edges) {
    literal(edge.label);
    if (!targets.has(edge.sourceId) || !targets.has(edge.targetId)) throw new Error('A component connection refers to a missing endpoint.');
  }
  const parents = new Map<string, string>();
  for (const group of groups) {
    literal(group.label);
    for (const member of group.members) {
      if (!targets.has(member) || parents.has(member)) throw new Error('Each component member must belong to one existing group.');
      parents.set(member, group.id);
    }
  }
  for (const group of groups) {
    if (group.parentId !== (parents.get(group.id) ?? null)) throw new Error('A component group has inconsistent containment.');
    const sequence = new Set([group.id]);
    for (let parent = group.parentId; parent; parent = byGroup.get(parent)?.parentId ?? null) {
      if (sequence.has(parent)) throw new Error('Component groups cannot contain a cycle.');
      sequence.add(parent);
    }
  }

  const parameters = uniquely(component.parameters, 'Each component parameter needs a distinct ID.');
  for (const parameter of component.parameters) {
    if (parameter.type === 'integer') {
      if (parameter.default < parameter.minimum || parameter.default > parameter.maximum) throw new Error('A component parameter has a default outside its range.');
    } else {
      literal(parameter.default);
      if (parameter.type === 'text' && [...parameter.default].length > parameter.maxLength) throw new Error('A component parameter has a default that is too long.');
      if (parameter.type === 'enum') {
        if (!parameter.choices.includes(parameter.default) || new Set(parameter.choices).size !== parameter.choices.length) {
          throw new Error('Choose a default from the component parameter’s distinct choices.');
        }
        parameter.choices.forEach(literal);
      }
    }
  }
  const bound = new Set<string>();
  for (const binding of component.labelBindings) {
    if (bound.has(binding.nodeId) || !byNode.has(binding.nodeId) || !parameters.has(binding.parameterId)) {
      throw new Error('Each label binding needs a distinct node and an existing parameter.');
    }
    bound.add(binding.nodeId);
    literal(binding.prefix);
    literal(binding.suffix);
  }
  uniquely(component.ports, 'Each component port needs a distinct ID.');
  if (component.ports.some(port => !byNode.has(port.nodeId))) throw new Error('A component port refers to a missing node.');
  return component;
}

export function parseComponentDefinition(text: string) {
  if (text.length > maxComponentBytes || encoder.encode(text).byteLength > maxComponentBytes) {
    throw new Error('A component definition can use at most 200,000 bytes.');
  }
  return validateComponentDefinition(decodeJson(text));
}

export function parseComponentFile(text: string): { definitions: ComponentDefinition[]; pack: boolean } {
  if (text.length > maxComponentLibraryBytes || encoder.encode(text).byteLength > maxComponentLibraryBytes) {
    throw new Error('Choose a library file no larger than 10,000,000 bytes.');
  }
  const value = decodeJson(text, 1_000_000);
  if (value && typeof value === 'object' && 'schema' in value && value.schema === 'meridian-library/v1') {
    if (Object.keys(value).length !== 2 || !('definitions' in value) || !Array.isArray(value.definitions) || value.definitions.length > 200) {
      throw new Error('A Meridian library file contains up to 200 component definitions.');
    }
    return { definitions: value.definitions.map(validateComponentDefinition), pack: true };
  }
  return { definitions: [validateComponentDefinition(value)], pack: false };
}
