import ProcessWorker from './process-steps.worker?worker&inline';
import { authoringLimits } from './flowchart-source';
import type { ProcessStep } from './process-steps';

export class ProcessNormalizationTimeout extends Error {
  constructor() {
    super('Reading the process steps timed out.');
    this.name = 'ProcessNormalizationTimeout';
  }
}

export async function normalizeProcessInWorker(text: string, signal: AbortSignal, extended = false): Promise<ProcessStep[]> {
  signal.throwIfAborted();
  if (text.length > authoringLimits.sourceCodeUnits) throw new Error('The process input is too large.');
  const worker = new ProcessWorker();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = window.setTimeout(() => finish(() => reject(new ProcessNormalizationTimeout())), extended ? 5_000 : 2_000);
    const abort = () => finish(() => reject(signal.reason));

    function finish(complete: () => void) {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      complete();
    }

    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data?.version !== 1 || data.id !== id) return;
      if (data.status === 'ready' && Array.isArray(data.steps)) finish(() => resolve(data.steps));
      else finish(() => reject(new Error(data.message || 'The process input could not be read.')));
    };
    worker.onerror = event => {
      event.preventDefault();
      finish(() => reject(new Error('The process input worker could not start.')));
    };
    try {
      worker.postMessage({ version: 1, id, text });
    } catch (reason) {
      finish(() => reject(reason));
    }
  });
}
