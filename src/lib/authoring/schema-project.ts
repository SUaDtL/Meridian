import { prepareGuidedFlowchart } from './guided-flowchart';
import type { MermaidProjectV3 } from './mermaid-project';
import type { SchemaFacts } from './schema-facts';
import { validateMermaidProject } from './validate-mermaid-project';

export function schemaScope(facts: SchemaFacts, selected: ReadonlyMap<string, string>, includeUnresolved: boolean) {
  const nodes = facts.facts.filter(item => selected.has(item.key)).map(item => ({
    ...item, label: selected.get(item.key)!, relationship: item.required ? 'Declared required property' : `JSON Schema ${item.kind}`,
  }));
  const links: (Omit<SchemaFacts['links'][number], 'kind'> & {
    kind: SchemaFacts['links'][number]['kind'] | 'Unresolved schema reference';
  })[] = facts.links.filter(item => selected.has(item.from) && selected.has(item.to));
  const unresolved = facts.unresolved.filter(item => selected.has(item.from));
  if (includeUnresolved) for (const [index, item] of unresolved.entries()) {
    const key = `unresolved-${index + 1}`;
    nodes.push({
      key, label: 'Unresolved reference', virtualPath: item.virtualPath, pointer: item.pointer,
      relationship: 'Unresolved schema reference', kind: 'reference target', required: false,
    });
    links.push({ ...item, to: key, kind: 'Unresolved schema reference' });
  }
  return { nodes, links, unresolved };
}

export async function prepareSchemaProject(
  facts: SchemaFacts, selected: ReadonlyMap<string, string>, includeUnresolved: boolean, signal: AbortSignal,
) {
  const { nodes, links } = schemaScope(facts, selected, includeUnresolved);
  if (!nodes.length || nodes.length > 100 || links.length > 200) {
    throw new Error('Choose a scope with 1 to 100 nodes and up to 200 connections.');
  }
  const prepared = await prepareGuidedFlowchart('JSON Schema relationships', {
    direction: 'LR',
    nodes: nodes.map(item => ({ key: item.key, label: item.label })),
    edges: links.map(item => ({ from: item.from, to: item.to, label: item.kind === 'Unresolved schema reference' ? 'Unresolved' : item.kind })),
  }, signal);
  signal.throwIfAborted();
  const ids = new Map(prepared.document.identity.elements.map(item => [item.binding.sourceId, item.id]));
  function origin(sourceId: string | undefined, path: string, pointer: string, relationship: string): MermaidProjectV3['provenance'][number] {
    const elementId = sourceId && ids.get(sourceId);
    if (!elementId) throw new Error('A schema fact could not be matched to its diagram element.');
    return { elementId, adapter: 'json-schema', adapterVersion: '1.0.0', virtualPath: path, pointer, relationship };
  }
  const provenance = [
    ...nodes.map(item => origin(prepared.generated.nodeIds.get(item.key), item.virtualPath, item.pointer, item.relationship)),
    ...links.map((item, index) => origin(prepared.generated.edgeIds[index], item.virtualPath, item.pointer, item.kind)),
  ];
  return { ...prepared, document: validateMermaidProject({ ...prepared.document, provenance }) };
}
