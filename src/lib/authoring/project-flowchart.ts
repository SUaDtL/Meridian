import { flowchartModelFor } from '../render';
import { proveFlowchartEdit, type SourceIntent } from './flowchart-proof';
import type { Shape } from './flowchart-source';
import { reconcileIdentities } from './identities';
import { observeFlowchartIdentities } from './identity-observation';
import type { MermaidProjectV3 } from './mermaid-project';
import { validateMermaidProject } from './validate-mermaid-project';

/** The flat canvas operations currently supported by the pinned source proof. */
export type NativeFlowchartEdit =
  | { op: 'addNode'; label: string; shape: Shape }
  | { op: 'setNodeLabel'; targetId: string; label: string }
  | { op: 'addEdge'; sourceId: string; targetId: string; label?: string };

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
    default:
      throw new Error('This operation is outside the supported editing subset.');
  }
  const proof = await proveFlowchartEdit({ source: document.source, settings: document.settings }, intent, signal);
  signal?.throwIfAborted();
  if (edit.op === 'setNodeLabel' && proof.source === document.source) return { document, elementId: edit.targetId };
  const model = flowchartModelFor(proof.render);
  if (!model) throw new Error('The edited flowchart could not be verified.');
  const observed = await observeFlowchartIdentities(model);
  signal?.throwIfAborted();
  // These operations can add identities and change labels. Every existing
  // binding and its retained annotations must stay intact.
  const priorIds = new Set(previous.map(item => item.id));
  const elements = reconcileIdentities(previous, observed, priorIds, document.identity.orphans.length);
  const nextById = new Map(elements.map(item => [item.id, item]));
  const added = elements.filter(item => !priorIds.has(item.id));
  const target = added[0];
  if (previous.some(item => nextById.get(item.id) !== item) || (edit.op === 'setNodeLabel'
    ? added.length !== 0
    : added.length !== 1 || target.elementKind !== (edit.op === 'addNode' ? 'node' : 'edge') || target.binding.sourceId !== proof.sourceId)) {
    throw new Error('The edit could not preserve the project’s existing identities.');
  }
  const candidate = validateMermaidProject({
    ...document,
    source: proof.source,
    identity: { ...document.identity, elements },
    revision: document.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  return { document: candidate, elementId: edit.op === 'setNodeLabel' ? edit.targetId : target.id };
}
