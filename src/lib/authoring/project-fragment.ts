import { flowchartModelFor } from '../render';
import { proveFlowchartFragment } from './flowchart-proof';
import { reconcileIdentities } from './identities';
import { observeFlowchartIdentities } from './identity-observation';
import type { MermaidProjectV3 } from './mermaid-project';
import type { FlowchartFragment } from './source-patches';

/** Prove the appended graph and bind only newly verified source declarations. */
export async function prepareProjectFragment(base: MermaidProjectV3, fragment: FlowchartFragment, signal?: AbortSignal) {
  const resolved = await proveFlowchartFragment(base, fragment, signal);
  const model = flowchartModelFor(resolved.rendered);
  if (!model) throw new Error('Mermaid could not verify the inserted elements.');
  const priorIds = new Set(base.identity.elements.map(item => item.id));
  const observed = await observeFlowchartIdentities(model);
  const elements = reconcileIdentities(base.identity.elements, observed, priorIds, base.identity.orphans.length);
  signal?.throwIfAborted();
  const byId = new Map(elements.map(item => [item.id, item]));
  const added = elements.filter(item => !priorIds.has(item.id));
  if (added.length !== resolved.nodes.length + resolved.edges.length || base.identity.elements.some(item => byId.get(item.id) !== item)) {
    throw new Error('The insertion could not retain all existing source bindings.');
  }
  const bySourceId = new Map(added.map(item => [item.binding.sourceId, item.id]));
  function bind(sourceId: string) {
    const id = bySourceId.get(sourceId);
    if (!id) throw new Error('A new element could not be verified.');
    return id;
  }
  return { ...resolved, elements, bind };
}
