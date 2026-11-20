type AuthoringWorkerResponse<Result> = { version: 1; id: string } & (
  { status: 'ready'; result: Result } | { status: 'failed'; message: string }
);

export class AuthoringWorkerTimeout extends Error {
  constructor(operation: string) {
    super(`${operation} timed out.`);
    this.name = 'AuthoringWorkerTimeout';
  }
}

export async function runAuthoringWorker<Result>(
  makeWorker: () => Worker, request: object, signal: AbortSignal, operation: string, extended: boolean,
): Promise<Result> {
  signal.throwIfAborted();
  const id = crypto.randomUUID();
  const worker = makeWorker();
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = window.setTimeout(() => finish(() => reject(new AuthoringWorkerTimeout(operation))), extended ? 5_000 : 2_000);
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
    worker.onmessage = ({ data }: MessageEvent<AuthoringWorkerResponse<Result>>) => {
      if (data?.version !== 1 || data.id !== id) return;
      if (data.status === 'ready') finish(() => resolve(data.result));
      else finish(() => reject(new Error(data.message || 'The input could not be read.')));
    };
    worker.onerror = event => {
      event.preventDefault();
      finish(() => reject(new Error('The input worker could not start.')));
    };
    try {
      worker.postMessage({ ...request, version: 1, id });
    } catch (reason) {
      finish(() => reject(reason));
    }
  });
}
