import { readSchemaFacts, type SchemaFile } from './schema-facts';

self.onmessage = ({ data }: MessageEvent<{ version: 1; id: string; files: SchemaFile[] }>) => {
  if (data?.version !== 1 || typeof data.id !== 'string') return;
  try {
    const result = readSchemaFacts(data.files);
    self.postMessage({ version: 1, id: data.id, status: 'ready', result });
  } catch (reason) {
    self.postMessage({
      version: 1, id: data.id, status: 'failed',
      message: reason instanceof Error ? reason.message : 'JSON Schema facts could not be read.',
    });
  }
};
