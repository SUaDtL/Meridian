import { readOpenApiFacts } from './openapi-facts';

self.onmessage = ({ data }: MessageEvent<{ version: 1; id: string; bytes: ArrayBuffer; virtualPath: string }>) => {
  if (data?.version !== 1 || typeof data.id !== 'string') return;
  try {
    const result = readOpenApiFacts(data.bytes, data.virtualPath);
    self.postMessage({ version: 1, id: data.id, status: 'ready', result });
  } catch (reason) {
    self.postMessage({ version: 1, id: data.id, status: 'failed', message: reason instanceof Error ? reason.message : 'OpenAPI operations could not be read.' });
  }
};
