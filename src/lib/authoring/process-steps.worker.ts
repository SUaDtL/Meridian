import { normalizeProcessSteps } from './process-steps';

self.addEventListener('message', (event: MessageEvent) => {
  const { version, id, text } = event.data ?? {};
  if (version !== 1 || typeof id !== 'string' || typeof text !== 'string') return;
  try {
    self.postMessage({ version, id, status: 'ready', result: normalizeProcessSteps(text) });
  } catch (reason) {
    self.postMessage({ version, id, status: 'failed', message: reason instanceof Error ? reason.message : 'The process input could not be read.' });
  }
});
