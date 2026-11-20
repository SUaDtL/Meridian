import { prepareGuidedFlowchart } from './guided-flowchart';
import { reviewedProcessGraph, type ProcessConnections } from './process-connections';
import type { ProcessStep } from './process-steps';

export type { ProcessStep } from './process-steps';

export function prepareGuidedProcess(title: string, steps: readonly ProcessStep[], signal?: AbortSignal, connections?: ProcessConnections) {
  signal?.throwIfAborted();
  return prepareGuidedFlowchart(title.trim() || 'Untitled process', reviewedProcessGraph(steps, connections), signal);
}
