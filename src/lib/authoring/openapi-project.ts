import { prepareGuidedFlowchart } from './guided-flowchart';
import type { OpenApiFacts } from './openapi-facts';
import type { MermaidProjectV3 } from './mermaid-project';
import { validateMermaidProject } from './validate-mermaid-project';

export type OpenApiChoice = { key: string; label: string; tag: string | null };
export const openApiNodeLimit = 100;
const relation = 'Declared OpenAPI tag membership';

export async function prepareOpenApiProject(title: string, facts: OpenApiFacts, choices: readonly OpenApiChoice[], signal: AbortSignal) {
  const byKey = new Map(facts.operations.map(operation => [operation.key, operation]));
  if (!choices.length || new Set(choices.map(item => item.key)).size !== choices.length) throw new Error('Select one or more distinct operations.');
  const tagGroups = new Map<string, string>();
  const nodes: Parameters<typeof prepareGuidedFlowchart>[1]['nodes'][number][] = [];
  const edges: Parameters<typeof prepareGuidedFlowchart>[1]['edges'][number][] = [];
  const nodeOrigins = new Map<string, { pointer: string; relationship: string }>();
  const edgePointers: string[] = [];
  for (const [index, choice] of choices.entries()) {
    const operation = byKey.get(choice.key);
    if (!operation) throw new Error('A selected operation is no longer available in these extracted facts.');
    const key = `operation-${index + 1}`;
    nodes.push({ key, label: choice.label, role: 'process' });
    nodeOrigins.set(key, { pointer: operation.pointer, relationship: 'Declared OpenAPI operation' });
    if (choice.tag === null) continue;
    const tagIndex = operation.tags.indexOf(choice.tag);
    if (tagIndex < 0) throw new Error('Choose a tag declared by this operation.');
    const pointer = `${operation.pointer}/tags/${tagIndex}`;
    let groupKey = tagGroups.get(choice.tag);
    if (!groupKey) {
      groupKey = `tag-${tagGroups.size + 1}`;
      tagGroups.set(choice.tag, groupKey);
      nodeOrigins.set(groupKey, { pointer, relationship: 'Declared OpenAPI tag' });
    }
    edges.push({ from: groupKey, to: key, label: 'Tags' });
    edgePointers.push(pointer);
  }
  for (const [tag, key] of tagGroups) nodes.push({ key, label: tag, role: 'neutral' });
  if (nodes.length > openApiNodeLimit || edges.length > 200) {
    throw new Error(`This selection would create ${nodes.length} nodes and ${edges.length} connections. Review a scope of up to 100 nodes and 200 connections.`);
  }
  const prepared = await prepareGuidedFlowchart(title, { direction: 'LR', nodes, edges }, signal);
  signal.throwIfAborted();
  const provenance: MermaidProjectV3['provenance'] = [];
  const identities = new Map(prepared.document.identity.elements.map(item => [item.binding.sourceId, item.id]));
  function append(sourceId: string | undefined, pointer: string, relationship: string) {
    const elementId = sourceId && identities.get(sourceId);
    if (!elementId) throw new Error('The rendered diagram could not retain an OpenAPI fact binding.');
    provenance.push({ elementId, adapter: 'openapi-operations', adapterVersion: '1.0.0', virtualPath: facts.virtualPath, pointer, relationship });
  }
  for (const [key, { pointer, relationship }] of nodeOrigins) append(prepared.generated.nodeIds.get(key), pointer, relationship);
  for (const [index, pointer] of edgePointers.entries()) append(prepared.generated.edgeIds[index], pointer, relation);
  return { ...prepared, document: validateMermaidProject({ ...prepared.document, provenance }), nodes: nodes.length, edges: edges.length };
}
