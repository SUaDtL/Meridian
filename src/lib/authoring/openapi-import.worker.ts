import { readOpenApiFacts, readOpenApiSchemaFiles, type OpenApiInput } from './openapi-facts';
import { readRestrictedOpenApiYaml } from './openapi-yaml';

type Work = { version: 1; id: string } & (OpenApiInput | { files: OpenApiInput[] });

self.onmessage = ({ data }: MessageEvent<Work>) => {
  if (data?.version !== 1 || typeof data.id !== 'string') return;
  try {
    const result = 'files' in data ? readOpenApiSchemaFiles(data.files, readRestrictedOpenApiYaml)
      : readOpenApiFacts(data.bytes, data.virtualPath, data.format === 'yaml' ? readRestrictedOpenApiYaml : undefined);
    self.postMessage({ version: 1, id: data.id, status: 'ready', result });
  } catch (reason) {
    self.postMessage({ version: 1, id: data.id, status: 'failed', message: reason instanceof Error ? reason.message : 'OpenAPI facts could not be read.' });
  }
};
