import { planFragmentSource, planStructuralSource } from './source-edit-plan';

self.addEventListener('message', (event: MessageEvent) => {
  const { version, id, action, source, intent, fragment } = event.data ?? {};
  if (version !== 1 || typeof id !== 'string' || typeof source !== 'string') return;
  try {
    const result = action === 'edit' && typeof intent?.op === 'string' ? planStructuralSource(source, intent)
      : action === 'fragment' && Array.isArray(fragment?.nodes) && Array.isArray(fragment?.edges) ? planFragmentSource(source, fragment)
      : undefined;
    if (result) self.postMessage({ version, id, status: 'ready', result });
  } catch (reason) {
    self.postMessage({ version, id, status: 'failed', message: reason instanceof Error ? reason.message : 'The proposed edit could not be planned.' });
  }
});
