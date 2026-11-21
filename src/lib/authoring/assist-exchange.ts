import { canonicalDigest, canonicalJson, projectBaseToken, sameBaseToken, type BaseToken } from './base-token';
import { decodeJson } from './decode-json';
import { authoringLimits, encodeMermaidLabel, type ConnectionDirection, type Shape } from './flowchart-source';
import { elementUuidPattern } from './identities';
import type { MermaidProjectV3 } from './mermaid-project';
import type { RenderTargetTable } from './project-render';
import common from './schemas/common.schema.json';
import { flowchartSubsetTopology } from './source-patches';
import { matchesBundledContract } from './validate-mermaid-project';

const requestDomain = 'meridian-assist-request/v1';
export const assistFileLimit = 128 * 1024;
export const requestIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const digestPattern = /^[a-f0-9]{64}$/;
const day = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();
export const assistOperations = ['setNodeLabel', 'setEdgeLabel', 'removeEdge', 'removeNode', 'addEdge', 'addNode'] as const;
type AssistOperation = typeof assistOperations[number];
export type AssistConnectionOperation = Extract<AssistOperation, 'setEdgeLabel' | 'removeEdge'>;

type Scope = {
  readContextIds: string[];
  writableElementIds: string[];
  attachmentPointIds: string[];
};
type Node = {
  id: string;
  elementKind: 'node';
  label: string;
  shape: Shape;
  parentGroupId: null;
  incidentEdgesComplete: boolean;
};
type Edge = {
  id: string;
  elementKind: 'edge';
  sourceId: string;
  targetId: string;
  label: string;
  direction: 'forward' | 'both' | 'none';
  lineStyle: 'solid' | 'dashed' | 'dotted';
};
type AssistRequest = {
  schema: 'meridian/assist-request/v1';
  requestId: string;
  documentKind: 'mermaid';
  baseToken: BaseToken;
  instruction: string;
  scope: Scope;
  graph: { nodes: Node[]; edges: Edge[]; groups: [] };
  allowedOperations: AssistOperation[];
};
export type PendingAssistRequest = {
  id: string;
  requestHash: string;
  baseToken: BaseToken;
  scope: Scope;
  allowedOperations: AssistOperation[];
  expiresAt: number;
};
type AssistantEdit = { op: 'setNodeLabel' | 'setEdgeLabel'; targetId: string; label: string }
  | { op: 'removeEdge'; targetId: string; annotationPolicy: 'preserve-orphans' }
  | { op: 'removeNode'; targetId: string; incidentEdgeIds: string[]; annotationPolicy: 'preserve-orphans' }
  | { op: 'addEdge'; ref: string; sourceId: string; targetId: string; label: string; direction: ConnectionDirection; lineStyle: 'solid' }
  | { op: 'addNode'; ref: string; label: string; shape: Shape; parentGroupId: null };
export type AssistSelection = 'context' | 'writable' | 'attachment';

export function assistWritableEdges(document: MermaidProjectV3, table: RenderTargetTable, selected: ReadonlyMap<string, AssistSelection>) {
  const explicit = new Set(document.identity.elements.filter(item => item.status === 'resolved' && item.binding.type === 'edge-id').map(item => item.id));
  return table.targets.filter(item => item.elementKind === 'edge' && explicit.has(item.id)
    && item.sourceId && item.targetId && selected.has(item.sourceId) && selected.has(item.targetId));
}

function uuidV7(now: number) {
  const bits = crypto.getRandomValues(new Uint8Array(16));
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index--) {
    bits[index] = Number(timestamp & 255n);
    timestamp >>= 8n;
  }
  bits[6] = (bits[6] & 15) | 112;
  bits[8] = (bits[8] & 63) | 128;
  const hex = Array.from(bits, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export async function buildAssistRequest(
  document: MermaidProjectV3,
  table: RenderTargetTable,
  edgeLabels: ReadonlyMap<string, string>,
  edgeStyles: ReadonlyMap<string, Edge['lineStyle']>,
  chosen: ReadonlyMap<string, AssistSelection>,
  instruction: string,
  writableEdges: ReadonlySet<string> = new Set(),
  edgeOperation: AssistConnectionOperation = 'setEdgeLabel',
  permissions: { removeNode?: boolean; addEdge?: boolean; addNode?: boolean } = {},
  now = Date.now(),
) {
  const token = await projectBaseToken(document);
  if (!sameBaseToken(table.baseToken, token) || table.targets.some(item => item.elementKind === 'group')) throw new Error('Choose a current supported flat flowchart.');
  if (!instruction.trim() || [...instruction].length > 2_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\uD800-\uDFFF]/u.test(instruction)) {
    throw new Error('Enter an instruction of 1 to 2,000 well-formed characters.');
  }
  const currentNodes = table.targets.filter(item => item.elementKind === 'node' && chosen.has(item.id));
  const writableNodes = currentNodes.filter(item => chosen.get(item.id) === 'writable').map(item => item.id);
  if (currentNodes.length > 100 || currentNodes.length !== chosen.size) {
    throw new Error('Choose up to 100 current nodes.');
  }
  const editable = assistWritableEdges(document, table, chosen).filter(item => writableEdges.has(item.id)).map(item => item.id);
  if (editable.length !== writableEdges.size) throw new Error('Choose writable connections with an explicit source ID and both endpoints in scope.');
  if (!writableNodes.length && !editable.length && !permissions.addNode) {
    throw new Error('Choose at least one writable node or connection, or explicitly allow a new node.');
  }
  const allowedOperations: AssistOperation[] = [];
  if (writableNodes.length) allowedOperations.push('setNodeLabel');
  if (editable.length) allowedOperations.push(edgeOperation);
  if (permissions.addEdge) {
    if (!writableNodes.length) throw new Error('Choose at least one writable node to allow a new connection.');
    allowedOperations.push('addEdge');
  }
  const attachmentPointIds = permissions.addEdge
    ? currentNodes.filter(item => chosen.get(item.id) === 'attachment').map(item => item.id) : [];
  const selected = new Set(currentNodes.map(item => item.id));
  const edges = table.targets.filter(item => item.elementKind === 'edge');
  const scopedEdges = edges.filter(item => item.sourceId && item.targetId && selected.has(item.sourceId) && selected.has(item.targetId));
  if (scopedEdges.length > 200) throw new Error('Narrow the selected scope to 200 relationships.');
  const scopedEdgeIds = new Set(scopedEdges.map(item => item.id));
  const byId = new Map(document.identity.elements.map(item => [item.id, item]));
  const shapes = new Map(flowchartSubsetTopology(document.source).nodes.map(item => [item.id, item.shape]));
  if (permissions.addNode) {
    if (shapes.size >= authoringLimits.graphNodes) throw new Error('The diagram is too large to allow a new node.');
    allowedOperations.push('addNode');
  }
  const request: AssistRequest = {
    schema: 'meridian/assist-request/v1',
    requestId: uuidV7(now),
    documentKind: 'mermaid',
    baseToken: token,
    instruction,
    scope: { readContextIds: [...selected, ...scopedEdgeIds], writableElementIds: [...writableNodes, ...editable], attachmentPointIds },
    graph: {
      nodes: currentNodes.map(item => {
        const identity = byId.get(item.id);
        const shape = identity && shapes.get(identity.binding.sourceId);
        if (!shape || !matchesBundledContract(item.label, common.$defs.Label)) {
          throw new Error('A selected node has an unsupported shape or label. Choose a smaller scope.');
        }
        return {
          id: item.id, elementKind: 'node', label: item.label, shape, parentGroupId: null,
          incidentEdgesComplete: edges.every(edge => (edge.sourceId !== item.id && edge.targetId !== item.id) || scopedEdgeIds.has(edge.id)),
        };
      }),
      edges: scopedEdges.map(item => {
        const label = edgeLabels.get(item.id);
        const lineStyle = edgeStyles.get(item.id);
        if (label === undefined || !item.sourceId || !item.targetId || !item.direction || !lineStyle
          || [...label].length > 200 || /[\u0000-\u001f\uD800-\uDFFF]/u.test(label)) {
          throw new Error('A selected relationship cannot be shared. Choose a smaller scope.');
        }
        return {
          id: item.id, elementKind: 'edge', sourceId: item.sourceId, targetId: item.targetId,
          label, direction: item.direction, lineStyle,
        };
      }),
      groups: [],
    },
    allowedOperations,
  };
  const removableNodes = permissions.removeNode && table.targets.filter(item => item.elementKind === 'node').length > 1
    ? request.graph.nodes.filter(node => chosen.get(node.id) === 'writable' && node.incidentEdgesComplete
      && edges.every(edge => (edge.sourceId !== node.id && edge.targetId !== node.id) || writableEdges.has(edge.id)))
    : [];
  if (permissions.removeNode) {
    if (!removableNodes.length) {
      throw new Error('Choose a writable node and mark every incident connection writable before allowing node removal. Keep at least one other node.');
    }
    allowedOperations.push('removeNode');
  }
  const text = JSON.stringify(request, null, 2);
  if (encoder.encode(text).byteLength > assistFileLimit) throw new Error('Narrow the request to 128 KiB.');
  const pending: PendingAssistRequest = {
    id: request.requestId, requestHash: await canonicalDigest(requestDomain, request), baseToken: token,
    scope: request.scope, allowedOperations: request.allowedOperations, expiresAt: now + day,
  };
  return { request, pending, text, removableNodes };
}

const renameSchema = {
  type: 'object', required: ['op', 'targetId', 'label'], additionalProperties: false,
  properties: { op: { const: 'setNodeLabel' }, targetId: common.$defs.UUID, label: common.$defs.Label },
};
const edgeLabelSchema = {
  ...renameSchema,
  properties: { ...renameSchema.properties, op: { const: 'setEdgeLabel' }, label: { type: 'string', maxLength: 200 } },
};
const edgeRemovalSchema = {
  type: 'object', required: ['op', 'targetId', 'annotationPolicy'], additionalProperties: false,
  properties: { op: { const: 'removeEdge' }, targetId: common.$defs.UUID, annotationPolicy: { const: 'preserve-orphans' } },
};
const nodeRemovalSchema = {
  ...edgeRemovalSchema,
  required: [...edgeRemovalSchema.required, 'incidentEdgeIds'],
  properties: {
    ...edgeRemovalSchema.properties,
    op: { const: 'removeNode' },
    incidentEdgeIds: { type: 'array', maxItems: 200, items: common.$defs.UUID },
  },
};
const edgeAdditionSchema = {
  type: 'object', additionalProperties: false,
  required: ['op', 'ref', 'sourceId', 'targetId', 'label', 'direction', 'lineStyle'],
  properties: {
    op: { const: 'addEdge' }, ref: common.$defs.NewRef, sourceId: common.$defs.UUID, targetId: common.$defs.UUID,
    label: { type: 'string', maxLength: 200 }, direction: { enum: ['forward', 'both', 'none'] }, lineStyle: { const: 'solid' },
  },
};
const nodeAdditionSchema = {
  type: 'object', additionalProperties: false,
  required: ['op', 'ref', 'label', 'shape', 'parentGroupId'],
  properties: { op: { const: 'addNode' }, ref: common.$defs.NewRef, label: common.$defs.Label,
    shape: common.$defs.Shape, parentGroupId: { type: 'null' } },
};
const proposalSchema = {
  type: 'object', additionalProperties: false,
  required: ['schema', 'id', 'documentKind', 'baseToken', 'origin', 'requestId', 'requestHash', 'operations'],
  properties: {
    schema: { const: 'meridian-proposal/v1' }, id: common.$defs.UUID, documentKind: { const: 'mermaid' },
    baseToken: common.$defs.BaseToken, origin: { const: 'ai' }, requestHash: common.$defs.Sha256,
    requestId: { type: 'string', pattern: requestIdPattern.source },
    operations: { type: 'array', minItems: 1, maxItems: 1, items: { oneOf: [renameSchema, edgeLabelSchema, edgeRemovalSchema, nodeRemovalSchema, edgeAdditionSchema, nodeAdditionSchema] } },
    explanation: { type: 'string', maxLength: 2000 },
  },
};
type ImportedEdit = { requestId: string; requestHash: string; baseToken: BaseToken; operations: [AssistantEdit] };

export function parseAssistSuggestion(text: string) {
  if (encoder.encode(text).byteLength > assistFileLimit) throw new Error('Choose a proposal no larger than 128 KiB.');
  const value = decodeJson(text);
  if (!matchesBundledContract(value, proposalSchema)) {
    throw new Error('Choose a Meridian assistant proposal with one supported edit that preserves annotations.');
  }
  return value as ImportedEdit;
}

export function authorizeAssistEdit(
  suggestion: ImportedEdit, pending: PendingAssistRequest, token: BaseToken, now = Date.now(),
): AssistantEdit {
  const edit = suggestion.operations[0];
  if (pending.expiresAt <= now || suggestion.requestId !== pending.id || suggestion.requestHash !== pending.requestHash
    || !sameBaseToken(pending.baseToken, suggestion.baseToken)) {
    throw new Error('This suggestion does not match a live request from this browser. Export a fresh request.');
  }
  if (!sameBaseToken(pending.baseToken, token)) throw new Error('The project changed since this request was exported. Export a fresh request.');
  const writable = new Set(pending.scope.writableElementIds);
  const readable = new Set(pending.scope.readContextIds);
  if (!pending.allowedOperations.includes(edit.op)) {
    throw new Error('The suggestion targets an element or operation outside the request’s writable scope.');
  }
  if (edit.op === 'addNode') {
    encodeMermaidLabel(edit.label);
    return edit;
  }
  if (edit.op === 'addEdge') {
    const endpoints = [edit.sourceId, edit.targetId];
    const attachments = new Set(pending.scope.attachmentPointIds);
    if (!endpoints.some(id => writable.has(id)) || endpoints.some(id => !readable.has(id) || (!writable.has(id) && !attachments.has(id)))) {
      throw new Error('A new connection needs a writable node and an authorized endpoint at both ends.');
    }
    if (edit.label) encodeMermaidLabel(edit.label);
    return edit;
  }
  if (!writable.has(edit.targetId) || !readable.has(edit.targetId) || !elementUuidPattern.test(edit.targetId)) {
    throw new Error('The suggestion targets an element or operation outside the request’s writable scope.');
  }
  if (edit.op === 'removeNode') {
    if (new Set(edit.incidentEdgeIds).size !== edit.incidentEdgeIds.length) throw new Error('List each incident connection once.');
    if (edit.incidentEdgeIds.some(id => !writable.has(id) || !readable.has(id))) {
      throw new Error('Every incident connection must be inside the request’s writable scope.');
    }
  }
  if (edit.op === 'setNodeLabel' || (edit.op === 'setEdgeLabel' && edit.label !== '')) encodeMermaidLabel(edit.label);
  return edit;
}

export function pendingAssistKey(value: PendingAssistRequest) {
  return canonicalJson(value);
}
