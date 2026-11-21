import { assistFileLimit } from '../authoring/assist-exchange';
import { decodeJson } from '../authoring/decode-json';
import { encodeMermaidLabel, type Shape } from '../authoring/flowchart-source';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';
import aiOperation from './ai-operation.schema.json';
import type { CompanionRequest } from './request';

type Parent = string | null;
type Target = { targetId: string };
type Added = { ref: string };
type Label = { label: string };
type Preserve = { annotationPolicy: 'preserve-orphans' };
type Endpoints = { sourceId: string; targetId: string };
type Placement = { parentGroupId: Parent };
type Operation =
  | ({ op: 'addNode'; shape: Shape } & Added & Label & Placement)
  | ({ op: 'setNodeLabel' | 'setEdgeLabel' } & Target & Label)
  | ({ op: 'addEdge'; direction: 'forward' | 'both' | 'none'; lineStyle: 'solid' | 'dashed' | 'dotted' } & Added & Endpoints & Label)
  | ({ op: 'removeEdge' } & Target & Preserve)
  | ({ op: 'removeNode'; incidentEdgeIds: string[] } & Target & Preserve)
  | ({ op: 'createGroup'; memberIds: string[] } & Added & Label & Placement)
  | ({ op: 'moveToGroup'; targetIds: string[] } & Placement);

type Node = { parentGroupId: Parent; incidentEdgesComplete: boolean };
type Group = { parentGroupId: Parent };

const schema = { type: 'array', minItems: 1, maxItems: 64, items: aiOperation };
const newRef = /^new:[a-z][a-z0-9_]{0,31}(?![\s\S])/;
const invalidScope = () => new Error('Companion operations exceed the request scope or conflict with the graph.');

function scopeChecked(operations: Operation[], request: CompanionRequest) {
  const allowed = new Set(request.allowedOperations);
  const writable = new Set(request.scope.writableElementIds);
  const attachments = new Set(request.scope.attachmentPointIds);
  const created = new Set<string>();
  const nodes = new Map<string, Node>(request.graph.nodes.map(node => [node.id, { ...node }]));
  const edges = new Map<string, Endpoints>(request.graph.edges.map(edge => [edge.id, edge]));
  const groups = new Map<string, Group>(request.graph.groups.map(group => [group.id, { ...group }]));
  const mayWrite = (id: string) => writable.has(id) || created.has(id);

  function requireWritableAncestors(parent: Parent, moved?: string) {
    while (parent !== null) {
      const group = groups.get(parent);
      if (!group || !mayWrite(parent) || parent === moved) throw invalidScope();
      parent = group.parentGroupId;
    }
  }

  function moveMembers(ids: string[], parent: Parent) {
    if (new Set(ids).size !== ids.length) throw invalidScope();
    requireWritableAncestors(parent);
    for (const id of ids) {
      const member = nodes.get(id) ?? groups.get(id);
      if (!member || !mayWrite(id)) throw invalidScope();
      requireWritableAncestors(member.parentGroupId);
      requireWritableAncestors(parent, id);
      member.parentGroupId = parent;
    }
  }

  for (const operation of operations) {
    if (!allowed.has(operation.op)) throw invalidScope();
    if ('ref' in operation) {
      if (!newRef.test(operation.ref) || created.has(operation.ref)) throw invalidScope();
      created.add(operation.ref);
    }
    if ('label' in operation && operation.label !== '') encodeMermaidLabel(operation.label);
    switch (operation.op) {
      case 'addNode':
        requireWritableAncestors(operation.parentGroupId);
        nodes.set(operation.ref, { parentGroupId: operation.parentGroupId, incidentEdgesComplete: true });
        break;
      case 'setNodeLabel':
      case 'setEdgeLabel': {
        const elements = operation.op === 'setNodeLabel' ? nodes : edges;
        if (!elements.has(operation.targetId) || !mayWrite(operation.targetId)) throw invalidScope();
        break;
      }
      case 'addEdge': {
        const endpoints = [operation.sourceId, operation.targetId];
        if (!endpoints.some(mayWrite) || endpoints.some(id => !nodes.has(id) || (!mayWrite(id) && !attachments.has(id)))) {
          throw invalidScope();
        }
        edges.set(operation.ref, { sourceId: operation.sourceId, targetId: operation.targetId });
        break;
      }
      case 'removeEdge':
        if (!mayWrite(operation.targetId) || !edges.delete(operation.targetId)) throw invalidScope();
        break;
      case 'removeNode': {
        const node = nodes.get(operation.targetId);
        if (!node?.incidentEdgesComplete || !mayWrite(operation.targetId)) throw invalidScope();
        requireWritableAncestors(node.parentGroupId);
        const listed = new Set(operation.incidentEdgeIds);
        const incident = [...edges].filter(([, edge]) => edge.sourceId === operation.targetId || edge.targetId === operation.targetId);
        if (listed.size !== operation.incidentEdgeIds.length || listed.size !== incident.length ||
            incident.some(([id]) => !listed.has(id) || !mayWrite(id))) throw invalidScope();
        for (const [id] of incident) edges.delete(id);
        nodes.delete(operation.targetId);
        break;
      }
      case 'createGroup':
        requireWritableAncestors(operation.parentGroupId);
        groups.set(operation.ref, { parentGroupId: operation.parentGroupId });
        moveMembers(operation.memberIds, operation.ref);
        break;
      case 'moveToGroup':
        moveMembers(operation.targetIds, operation.parentGroupId);
        break;
    }
  }
}

/** Check provider operation bytes against the closed contract and the request's exact graph. */
export function validateCompanionOperations(text: string, request: CompanionRequest) {
  if (new TextEncoder().encode(text).byteLength > assistFileLimit) throw new Error('Proposal exceeds 128 KiB.');
  const candidate = decodeJson(text, 20_000, 'number', undefined, 8);
  if (!matchesBundledContract(candidate, schema)) throw new Error('Invalid companion operations.');
  const operations = candidate as Operation[];
  scopeChecked(operations, request);
  return operations;
}
