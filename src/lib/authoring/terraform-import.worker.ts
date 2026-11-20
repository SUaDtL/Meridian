import { readTerraformFacts } from './terraform-facts';

self.onmessage = ({ data }: MessageEvent<{ version: 1; id: string; bytes: ArrayBuffer; virtualPath: string }>) => {
  if (data?.version !== 1 || typeof data.id !== 'string') return;
  try {
    const result = readTerraformFacts(data.bytes, data.virtualPath);
    self.postMessage({ version: 1, id: data.id, status: 'ready', result });
  } catch (reason) {
    self.postMessage({ version: 1, id: data.id, status: 'failed', message: reason instanceof Error ? reason.message : 'Terraform facts could not be read.' });
  }
};
