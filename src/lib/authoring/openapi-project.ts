import { prepareGuidedFlowchart } from './guided-flowchart';
import type { OpenApiFacts } from './openapi-facts';
import type { MermaidProjectV3 } from './mermaid-project';
import { validateMermaidProject } from './validate-mermaid-project';

export type OpenApiSchemaChoice = { key: string; label: string };
export type OpenApiChoice = OpenApiSchemaChoice & { tag: string | null };
export const openApiNodeLimit = 100;
type Graph = Parameters<typeof prepareGuidedFlowchart>[1];
type Origin = { virtualPath: string; pointer: string; relationship: string };

export async function prepareOpenApiProject(title: string, facts: OpenApiFacts, choices: readonly OpenApiChoice[], signal: AbortSignal) {
  const byKey = new Map(facts.operations.map(operation => [operation.key, operation]));
  if (!choices.length || new Set(choices.map(item => item.key)).size !== choices.length) throw new Error('Select one or more distinct operations.');
  const tagGroups = new Map<string, string>();
  const nodes: Graph['nodes'][number][] = [];
  const edges: Graph['edges'][number][] = [];
  const nodeOrigins = new Map<string, Origin>();
  const edgeOrigins: Origin[] = [];
  for (const [index, choice] of choices.entries()) {
    const operation = byKey.get(choice.key);
    if (!operation) throw new Error('A selected operation is no longer available in these extracted facts.');
    const key = `operation-${index + 1}`;
    nodes.push({ key, label: choice.label, role: 'process' });
    nodeOrigins.set(key, { virtualPath: facts.virtualPath, pointer: operation.pointer, relationship: 'Declared OpenAPI operation' });
    if (choice.tag === null) continue;
    const tagIndex = operation.tags.indexOf(choice.tag);
    if (tagIndex < 0) throw new Error('Choose a tag declared by this operation.');
    const pointer = `${operation.pointer}/tags/${tagIndex}`;
    let groupKey = tagGroups.get(choice.tag);
    if (!groupKey) {
      groupKey = `tag-${tagGroups.size + 1}`;
      tagGroups.set(choice.tag, groupKey);
      nodeOrigins.set(groupKey, { virtualPath: facts.virtualPath, pointer, relationship: 'Declared OpenAPI tag' });
    }
    edges.push({ from: groupKey, to: key, label: 'Tags' });
    edgeOrigins.push({ virtualPath: facts.virtualPath, pointer, relationship: 'Declared OpenAPI tag membership' });
  }
  for (const [tag, key] of tagGroups) nodes.push({ key, label: tag, role: 'neutral' });
  return renderFacts(title, 'openapi-operations', { direction: 'LR', nodes, edges }, nodeOrigins, edgeOrigins, signal);
}

export function openApiSchemaScope(facts: OpenApiFacts, selection: ReadonlyMap<string, OpenApiSchemaChoice>) {
  if (!facts.schemaView) throw new Error('Read OpenAPI schema facts before choosing a schema scope.');
  return {
    schemas: facts.schemaView.schemas.filter(schema => selection.has(schema.key)),
    references: facts.schemaView.references.filter(reference => selection.has(reference.from) && selection.has(reference.to)),
  };
}

export async function prepareOpenApiSchemaProject(title: string, facts: OpenApiFacts, choices: ReadonlyMap<string, OpenApiSchemaChoice>, signal: AbortSignal) {
  const { schemas, references } = openApiSchemaScope(facts, choices);
  if (!schemas.length || schemas.length !== choices.size) throw new Error('Select one or more available schemas.');
  const nodes = schemas.map(schema => ({ key: schema.key, label: choices.get(schema.key)!.label }));
  const edges = references.map(reference => ({ from: reference.from, to: reference.to, label: 'Declared schema reference' }));
  const nodeOrigins = new Map(schemas.map(({ key, virtualPath, pointer }) => [key, { virtualPath, pointer, relationship: 'Declared OpenAPI schema' }]));
  const edgeOrigins = references.map(({ virtualPath, pointer }) => ({ virtualPath, pointer, relationship: 'Declared OpenAPI schema reference' }));
  return renderFacts(title, 'openapi-schemas', { direction: 'LR', nodes, edges }, nodeOrigins, edgeOrigins, signal);
}

async function renderFacts(title: string, adapter: string, graph: Graph,
  nodeOrigins: ReadonlyMap<string, Origin>, edgeOrigins: readonly Origin[], signal: AbortSignal) {
  const { nodes, edges } = graph;
  if (nodes.length > openApiNodeLimit || edges.length > 200) {
    throw new Error(`This selection would create ${nodes.length} nodes and ${edges.length} connections. Review a scope of up to 100 nodes and 200 connections.`);
  }
  const prepared = await prepareGuidedFlowchart(title, graph, signal);
  signal.throwIfAborted();
  const provenance: MermaidProjectV3['provenance'] = [];
  const identities = new Map(prepared.document.identity.elements.map(item => [item.binding.sourceId, item.id]));
  function append(sourceId: string | undefined, origin: Origin) {
    const elementId = sourceId && identities.get(sourceId);
    if (!elementId) throw new Error('The rendered diagram could not retain an OpenAPI fact binding.');
    provenance.push({ elementId, adapter, adapterVersion: '1.0.0', ...origin });
  }
  for (const [key, origin] of nodeOrigins) append(prepared.generated.nodeIds.get(key), origin);
  for (const [index, origin] of edgeOrigins.entries()) append(prepared.generated.edgeIds[index], origin);
  return { ...prepared, document: validateMermaidProject({ ...prepared.document, provenance }), nodes: nodes.length, edges: edges.length };
}
