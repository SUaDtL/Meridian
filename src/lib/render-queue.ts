export function renderAborted(): Error {
  const error = new Error('A newer diagram replaced this render.');
  error.name = 'AbortError';
  return error;
}

export function checkRenderSignal(signal: AbortSignal): void {
  if (signal.aborted) throw renderAborted();
}

interface Listener<T> {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  removeAbortListener: () => void;
}

interface Request<Input, Output> {
  key: string;
  input: Input;
  controller: AbortController;
  listeners: Set<Listener<Output>>;
}

/**
 * Mermaid owns a global configuration and cannot run two layouts concurrently.
 * Keep at most one running task and the newest waiting request. Aborting a
 * running Mermaid call stops its remaining work at the next async boundary;
 * the next task still waits for the call to settle before changing its config.
 */
export function latestRenderQueue<Input, Output>(execute: (input: Input, signal: AbortSignal) => Promise<Output>) {
  let active: Request<Input, Output> | undefined;
  let waiting: Request<Input, Output> | undefined;

  const reject = (request: Request<Input, Output>) => {
    request.controller.abort();
    for (const listener of request.listeners) {
      listener.removeAbortListener();
      listener.reject(renderAborted());
    }
    request.listeners.clear();
  };

  const start = (request: Request<Input, Output>) => {
    active = request;
    // Starting in a microtask also collapses several synchronous submissions.
    Promise.resolve().then(() => {
      checkRenderSignal(request.controller.signal);
      return execute(request.input, request.controller.signal);
    }).then(value => {
      for (const listener of request.listeners) {
        listener.removeAbortListener();
        listener.resolve(value);
      }
    }, error => {
      for (const listener of request.listeners) {
        listener.removeAbortListener();
        listener.reject(error);
      }
    }).finally(() => {
      request.listeners.clear();
      active = undefined;
      const next = waiting;
      waiting = undefined;
      if (next) start(next);
    });
  };

  const cancel = () => {
    if (waiting) { reject(waiting); waiting = undefined; }
    if (active) reject(active);
  };

  const submit = (key: string, input: Input, signal?: AbortSignal): Promise<Output> => {
    if (signal?.aborted) return Promise.reject(renderAborted());
    let request = waiting?.key === key && !waiting.controller.signal.aborted ? waiting
      : active?.key === key && !active.controller.signal.aborted ? active : undefined;
    if (!request) {
      if (waiting) { reject(waiting); waiting = undefined; }
      if (active) reject(active);
      request = { key, input, controller: new AbortController(), listeners: new Set() };
      if (active) waiting = request;
    }
    const target = request;
    const promise = new Promise<Output>((resolve, rejectPromise) => {
      const listener: Listener<Output> = { resolve, reject: rejectPromise, removeAbortListener: () => signal?.removeEventListener('abort', abort) };
      const abort = () => {
        target.listeners.delete(listener);
        listener.removeAbortListener();
        rejectPromise(renderAborted());
        if (!target.listeners.size) {
          target.controller.abort();
          if (waiting === target) waiting = undefined;
        }
      };
      target.listeners.add(listener);
      signal?.addEventListener('abort', abort, { once: true });
    });
    if (!active) start(target);
    return promise;
  };

  return { submit, cancel };
}
