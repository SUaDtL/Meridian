import { prepareGuidedFlowchart } from './guided-flowchart';
import { reviewedProcessGraph, type ProcessConnections } from './process-connections';
import type { ProcessStep } from './process-steps';
import { prepareGuidedFragmentInsertion, type GuidedAttachment } from './guided-systems-insertion';
import type { MermaidProjectV3 } from './mermaid-project';

export type { ProcessStep } from './process-steps';

export function prepareGuidedProcess(title: string, steps: readonly ProcessStep[], signal?: AbortSignal, connections?: ProcessConnections) {
  signal?.throwIfAborted();
  return prepareGuidedFlowchart(title.trim() || 'Untitled process', reviewedProcessGraph(steps, connections), signal);
}

export function prepareGuidedProcessInsertion(
  base: MermaidProjectV3, steps: readonly ProcessStep[], connections?: ProcessConnections,
  attachment?: GuidedAttachment, signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const process = reviewedProcessGraph(steps, connections);
  if (attachment?.direction === 'to-existing' && connections?.terminal.includes(Number(attachment.draftNodeId))) {
    throw new Error('A step marked as an end cannot have an outgoing attachment.');
  }
  const edges = process.edges.map((edge, index) => ({
    key: `step-${index + 1}`, from: { key: edge.from }, to: { key: edge.to }, label: edge.label ?? '', direction: edge.direction,
  }));
  const nodes = process.nodes.map(node => ({ ...node, shape: node.shape ?? 'rect' as const }));
  return prepareGuidedFragmentInsertion(base, nodes, edges, attachment, signal);
}
