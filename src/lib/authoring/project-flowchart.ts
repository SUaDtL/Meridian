import { flowchartModelFor } from '../render';
import { proveFlowchartEdit, type SourceIntent } from './flowchart-proof';
import type { Shape } from './flowchart-source';
import { reconcileIdentities } from './identities';
import { observeFlowchartIdentities } from './identity-observation';
import type { MermaidProjectV3 } from './mermaid-project';
import { retireConnection } from './retire-connection';
import { validateMermaidProject } from './validate-mermaid-project';

/** The flat canvas operations currently supported by the pinned source proof. */
export type NativeFlowchartEdit =
  | { op: 'addNode'; label: string; shape: Shape }
  | { op: 'setNodeLabel'; targetId: string; label: string }
  | { op: 'addEdge'; sourceId: string; targetId: string; label?: string }
  | { op: 'removeEdge'; targetId: string };

export async function prepareFlowchartCandidate(document: MermaidProjectV3, edit: NativeFlowchartEdit, signal?: AbortSignal) {
  const previous = document.identity.elements;
  function nodeSourceId(id: string) {
    const record = previous.find(item => item.id === id);
    if (!record || record.status !== 'resolved' || record.elementKind !== 'node') {
      throw new Error('Choose a current node in this project.');
    }
    return record.binding.sourceId;
  }

  let intent: SourceIntent;
  let retired: ReturnType<typeof retireConnection> | undefined;
  switch (edit.op) {
    case 'addNode':
      intent = { op: 'addNode', label: edit.label, shape: edit.shape };
      break;
    case 'setNodeLabel':
      intent = { op: 'setNodeLabel', sourceId: nodeSourceId(edit.targetId), label: edit.label };
      break;
    case 'addEdge':
      intent = { op: 'addEdge', from: nodeSourceId(edit.sourceId), to: nodeSourceId(edit.targetId), label: edit.label };
      break;
    case 'removeEdge': {
      const edge = previous.find(item => item.id === edit.targetId);
      if (!edge || edge.status !== 'resolved' || edge.elementKind !== 'edge' || edge.binding.type !== 'edge-id') {
        throw new Error('Choose a current connection with an explicit source ID.');
      }
      intent = { op: 'removeEdge', sourceId: edge.binding.sourceId };
      retired = retireConnection(document, edge.id, edge.binding.sourceId);
      break;
    }
    default:
      throw new Error('This operation is outside the supported editing subset.');
  }
  const proof = await proveFlowchartEdit({ source: document.source, settings: document.settings }, intent, signal);
  signal?.throwIfAborted();
  if (edit.op === 'setNodeLabel' && proof.source === document.source) return { document, elementId: edit.targetId, impact: undefined };
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
  const target = added[0];
  const validPrior = previous.every(item => edit.op === 'removeEdge' && item.id === edit.targetId
    ? nextById.get(item.id)?.status === 'retired' : nextById.get(item.id) === item);
  if (!validPrior || (edit.op === 'setNodeLabel' || edit.op === 'removeEdge'
    ? added.length !== 0
    : added.length !== 1 || target.elementKind !== (edit.op === 'addNode' ? 'node' : 'edge') || target.binding.sourceId !== proof.sourceId)) {
    throw new Error('The edit could not preserve the project’s existing identities.');
  }
  const candidate = validateMermaidProject({
    ...document,
    source: proof.source,
    identity: { ...document.identity, elements, orphans },
    design: retired?.design ?? document.design,
    roles: retired?.roles ?? document.roles,
    storyboard: retired?.storyboard ?? document.storyboard,
    revision: document.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  return { document: candidate, elementId: edit.op === 'setNodeLabel' || edit.op === 'removeEdge' ? edit.targetId : target.id, impact: retired?.impact };
}
