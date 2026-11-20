import { flowchartModelFor } from '../render';
import { proveFlowchartEdit, type SourceIntent } from './flowchart-proof';
import type { ConnectionDirection, Shape } from './flowchart-source';
import { reconcileIdentities } from './identities';
import { observeFlowchartIdentities } from './identity-observation';
import type { MermaidProjectV3, SemanticRole } from './mermaid-project';
import { retireElements } from './retire-elements';
import { validateMermaidProject } from './validate-mermaid-project';

/** The flat canvas operations currently supported by the pinned source proof. */
export type NativeFlowchartEdit =
  | { op: 'addNode'; label: string; shape: Shape }
  | { op: 'addNext'; anchorId: string; label: string; shape: Shape; edgeLabel?: string; incoming: boolean; role?: SemanticRole }
  | { op: 'setNodeLabel' | 'setEdgeLabel'; targetId: string; label: string }
  | { op: 'addEdge'; sourceId: string; targetId: string; label?: string; direction?: ConnectionDirection }
  | { op: 'addGroup'; memberIds: readonly string[]; label: string }
  | { op: 'removeGroup'; targetId: string }
  | { op: 'removeNode'; targetId: string; incidentEdgeIds: readonly string[] }
  | { op: 'removeEdge'; targetId: string };

export async function prepareFlowchartCandidate(document: MermaidProjectV3, edit: NativeFlowchartEdit, signal?: AbortSignal) {
  const previous = document.identity.elements;
  const previousById = new Map(previous.map(item => [item.id, item]));
  function nodeSourceId(id: string) {
    const record = previousById.get(id);
    if (!record || record.status !== 'resolved' || record.elementKind !== 'node') {
      throw new Error('Choose a current node in this project.');
    }
    return record.binding.sourceId;
  }
  function edgeSourceId(id: string) {
    const edge = previousById.get(id);
    if (!edge || edge.status !== 'resolved' || edge.elementKind !== 'edge' || edge.binding.type !== 'edge-id') {
      throw new Error('Choose a current connection with an explicit source ID.');
    }
    return edge.binding.sourceId;
  }

  let intent: SourceIntent;
  let removal: { id: string; legacyKey: string }[] = [];
  switch (edit.op) {
    case 'addNode':
      intent = { op: 'addNode', label: edit.label, shape: edit.shape };
      break;
    case 'addNext':
      intent = { op: 'addNext', anchor: nodeSourceId(edit.anchorId), label: edit.label, shape: edit.shape,
        edgeLabel: edit.edgeLabel, incoming: edit.incoming };
      break;
    case 'setNodeLabel':
      intent = { op: 'setNodeLabel', sourceId: nodeSourceId(edit.targetId), label: edit.label };
      break;
    case 'setEdgeLabel':
      intent = { op: 'setEdgeLabel', sourceId: edgeSourceId(edit.targetId), label: edit.label };
      break;
    case 'addEdge':
      intent = { op: 'addEdge', from: nodeSourceId(edit.sourceId), to: nodeSourceId(edit.targetId), label: edit.label, direction: edit.direction };
      break;
    case 'addGroup':
      intent = { op: 'addGroup', members: edit.memberIds.map(nodeSourceId), label: edit.label };
      break;
    case 'removeGroup': {
      const group = previousById.get(edit.targetId);
      if (!group || group.status !== 'resolved' || group.elementKind !== 'group') throw new Error('Choose a current diagram group.');
      intent = { op: 'removeGroup', sourceId: group.binding.sourceId };
      removal = [{ id: group.id, legacyKey: `group:${group.binding.sourceId}` }];
      break;
    }
    case 'removeEdge': {
      const sourceId = edgeSourceId(edit.targetId);
      intent = { op: 'removeEdge', sourceId };
      removal = [{ id: edit.targetId, legacyKey: `edge:id:${sourceId}` }];
      break;
    }
    case 'removeNode': {
      const sourceId = nodeSourceId(edit.targetId);
      const incidentEdgeIds = edit.incidentEdgeIds.map(edgeSourceId);
      intent = { op: 'removeNode', sourceId, incidentEdgeIds };
      removal = [{ id: edit.targetId, legacyKey: `node:${sourceId}` },
        ...edit.incidentEdgeIds.map((id, index) => ({ id, legacyKey: `edge:id:${incidentEdgeIds[index]}` }))];
      break;
    }
    default:
      throw new Error('This operation is outside the supported editing subset.');
  }
  const proof = await proveFlowchartEdit({ source: document.source, settings: document.settings }, intent, signal);
  signal?.throwIfAborted();
  const retired = removal.length ? retireElements(document, removal) : undefined;
  if ((edit.op === 'setNodeLabel' || edit.op === 'setEdgeLabel') && proof.source === document.source) return { document, elementId: edit.targetId, impact: undefined };
  const model = flowchartModelFor(proof.render);
  if (!model) throw new Error('The edited flowchart could not be verified.');
  const observed = await observeFlowchartIdentities(model);
  signal?.throwIfAborted();
  // These operations can add identities and change labels. Every existing
  // binding and its retained annotations must stay intact.
  const priorIds = new Set(previous.map(item => item.id));
  const orphans = retired?.orphans ?? document.identity.orphans;
  const elements = reconcileIdentities(previous, observed, priorIds, orphans.length);
  const nextById = new Map(elements.map(item => [item.id, item]));
  const added = elements.filter(item => !priorIds.has(item.id));
  const removedIds = new Set(removal.map(item => item.id));
  const validPrior = previous.every(item => removedIds.has(item.id)
    ? nextById.get(item.id)?.status === 'retired' : nextById.get(item.id) === item);
  const target = added.find(item => item.binding.sourceId === proof.sourceId
    && item.elementKind === (edit.op === 'addEdge' ? 'edge' : edit.op === 'addGroup' ? 'group' : 'node'));
  const noNewIdentity = edit.op === 'setNodeLabel' || edit.op === 'setEdgeLabel' || edit.op === 'removeEdge' || edit.op === 'removeNode' || edit.op === 'removeGroup';
  const validAdded = noNewIdentity ? !added.length
    : edit.op === 'addNext' ? added.length === 2 && !!target && added.some(item => item.elementKind === 'edge' && item.binding.sourceId === proof.addedEdgeId)
    : added.length === 1 && !!target;
  if (!validPrior || !validAdded) {
    throw new Error('The edit could not preserve the project’s existing identities.');
  }
  const elementId = noNewIdentity ? edit.targetId : target!.id;
  const roles = retired?.roles ?? document.roles;
  const candidate = validateMermaidProject({
    ...document,
    source: proof.source,
    identity: { ...document.identity, elements, orphans },
    design: retired?.design ?? document.design,
    roles: edit.op === 'addNext' && edit.role ? [...roles, { elementId, role: edit.role }] : roles,
    storyboard: retired?.storyboard ?? document.storyboard,
    revision: document.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  return { document: candidate, elementId, impact: retired?.impact };
}
