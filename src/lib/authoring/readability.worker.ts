import { analyzeReadability } from './readability';

self.addEventListener('message', (event: MessageEvent) => {
  const { version, id, targets, profile, frame } = event.data ?? {};
  if (version !== 1 || typeof id !== 'string' || !Array.isArray(targets) || !profile || !frame) return;
  try {
    self.postMessage({ version, id, status: 'ready', result: analyzeReadability(targets, profile, frame) });
  } catch (reason) {
    self.postMessage({ version, id, status: 'failed', message: reason instanceof Error ? reason.message : 'The diagram could not be checked.' });
  }
});
