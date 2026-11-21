import { assistFileLimit, assistRequestDomain } from '../authoring/assist-exchange';
import { requestIdPattern } from '../authoring/assist-request-id';
import { canonicalDigest, type BaseToken } from '../authoring/base-token';
import { decodeJson } from '../authoring/decode-json';
import common from '../authoring/schemas/common.schema.json';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';

const operations = [
  'addNode', 'setNodeLabel', 'addEdge', 'setEdgeLabel', 'removeEdge',
  'removeNode', 'createGroup', 'moveToGroup',
] as const;
const exactPattern = (pattern: string) => pattern.replace(/\$$/, '(?![\\s\\S])');
const uuid = { ...common.$defs.UUID, pattern: exactPattern(common.$defs.UUID.pattern) };
const digest = { ...common.$defs.Sha256, pattern: exactPattern(common.$defs.Sha256.pattern) };
const baseToken = {
  ...common.$defs.BaseToken,
  properties: { ...common.$defs.BaseToken.properties, projectId: uuid, contentHash: digest, stateDigest: digest },
};
const label = { ...common.$defs.Label, pattern: exactPattern(common.$defs.Label.pattern) };
const parent = { anyOf: [uuid, { type: 'null' }] };
const ids = (maxItems: number) => ({ type: 'array', maxItems, items: uuid });
const list = (items: unknown, maxItems: number) => ({ type: 'array', items, maxItems });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const nodeFields = {
  id: uuid, elementKind: { const: 'node' }, label, shape: common.$defs.Shape, parentGroupId: parent,
  incidentEdgesComplete: { type: 'boolean' },
};
const node = object({ ...nodeFields, role: common.$defs.Role }, Object.keys(nodeFields));
const edge = object({
  id: uuid, elementKind: { const: 'edge' }, sourceId: uuid, targetId: uuid,
  label: { ...label, minLength: 0 },
  direction: { enum: ['forward', 'both', 'none'] },
  lineStyle: { enum: ['solid', 'dashed', 'dotted'] },
});
const group = object({ id: uuid, elementKind: { const: 'group' }, label, parentGroupId: parent, memberIds: ids(120) });
const requestSchema = object({
  schema: { const: 'meridian/assist-request/v1' },
  requestId: { type: 'string', pattern: exactPattern(requestIdPattern.source) },
  documentKind: { const: 'mermaid' },
  baseToken,
  instruction: { type: 'string', minLength: 1, maxLength: 2_000, pattern: '^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]*(?![\\s\\S])' },
  scope: object({ readContextIds: ids(320), writableElementIds: ids(320), attachmentPointIds: ids(100) }),
  graph: object({ nodes: list(node, 100), edges: list(edge, 200), groups: list(group, 20) }),
  allowedOperations: { ...list({ enum: operations }, 8), minItems: 1 },
});

type Scope = { readContextIds: string[]; writableElementIds: string[]; attachmentPointIds: string[] };
type Member = { id: string; parentGroupId: string | null; label: string };
type ContextNode = Member & {
  elementKind: 'node'; incidentEdgesComplete: boolean; shape: string; role?: string;
};
type ContextEdge = {
  id: string; elementKind: 'edge'; sourceId: string; targetId: string; label: string;
  direction: 'forward' | 'both' | 'none'; lineStyle: 'solid' | 'dashed' | 'dotted';
};
type ContextGroup = Member & { elementKind: 'group'; memberIds: string[] };
export type CompanionRequest = {
  schema: 'meridian/assist-request/v1';
  documentKind: 'mermaid';
  requestId: string;
  baseToken: BaseToken;
  instruction: string;
  scope: Scope;
  graph: { nodes: ContextNode[]; edges: ContextEdge[]; groups: ContextGroup[] };
  allowedOperations: Array<typeof operations[number]>;
};

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function consistentGraph(request: CompanionRequest) {
  const { nodes, edges, groups } = request.graph;
  const { readContextIds, writableElementIds, attachmentPointIds } = request.scope;
  const nodeIds = new Set(nodes.map(item => item.id));
  const elementIds = [...nodes, ...edges, ...groups].map(item => item.id);
  const readable = new Set(readContextIds);
  if (!unique(elementIds) || !unique(readContextIds) || !unique(writableElementIds) || !unique(attachmentPointIds) ||
      !unique(request.allowedOperations) || readable.size !== elementIds.length ||
      elementIds.some(id => !readable.has(id)) || writableElementIds.some(id => !readable.has(id)) ||
      attachmentPointIds.some(id => !nodeIds.has(id)) ||
      edges.some(({ sourceId, targetId }) => !nodeIds.has(sourceId) || !nodeIds.has(targetId))) return false;

  const parents = new Map(groups.map(item => [item.id, item]));
  const members = new Map([...nodes, ...groups].map(item => [item.id, item]));
  for (const item of members.values()) {
    if (item.parentGroupId !== null && !parents.get(item.parentGroupId)?.memberIds.includes(item.id)) return false;
  }
  for (const item of groups) {
    if (!unique(item.memberIds) || item.memberIds.some(id => members.get(id)?.parentGroupId !== item.id)) return false;
    const ancestry = new Set([item.id]);
    let ancestor = item.parentGroupId;
    while (ancestor !== null) {
      if (ancestry.has(ancestor)) return false;
      ancestry.add(ancestor);
      ancestor = parents.get(ancestor)!.parentGroupId;
    }
  }
  return true;
}

/** Validate raw file bytes before canonical hashing or provider work. */
export async function parseCompanionRequest(bytes: Uint8Array) {
  if (bytes.byteLength > assistFileLimit) throw new Error('Choose a request no larger than 128 KiB.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const candidate = decodeJson(text, 6_000, 'number', undefined, 8);
  if (!matchesBundledContract(candidate, requestSchema)) throw new Error('Invalid Meridian assistant request.');
  const request = candidate as CompanionRequest;
  if (!request.instruction.trim() || !consistentGraph(request)) {
    throw new Error('Invalid Meridian assistant request scope or graph.');
  }
  return { request, requestHash: await canonicalDigest(assistRequestDomain, request) };
}
