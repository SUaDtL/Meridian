import ProcessWorker from './process-steps.worker?worker&inline';
import { runAuthoringWorker } from './authoring-worker';
import { authoringLimits } from './flowchart-source';
import type { ProcessStep } from './process-steps';

export async function normalizeProcessInWorker(text: string, signal: AbortSignal, extended = false): Promise<ProcessStep[]> {
  signal.throwIfAborted();
  if (text.length > authoringLimits.sourceCodeUnits) throw new Error('The process input is too large.');
  return runAuthoringWorker<ProcessStep[]>(() => new ProcessWorker(), { text }, signal, 'Reading the process steps', extended);
}
