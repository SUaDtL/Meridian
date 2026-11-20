import { decodeJson } from './decode-json';

const maxBytes = 2_000_000;
const maxFacts = 10_000;
const maxText = 2_000;
const methods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
const surrogate = /[\uD800-\uDFFF]/u;
const virtualName = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const supportedVersion = /^3\.[01]\.\d+$/;
const pointerToken = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');

export type OpenApiOperation = {
  key: string;
  method: (typeof methods)[number];
  path: string;
  tags: string[];
  pointer: string;
};
export type OpenApiFacts = {
  version: string;
  virtualPath: string;
  operations: OpenApiOperation[];
  referencedPathCount: number;
  uncheckedSchemaCount: number;
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateVirtualPath(value: string) {
  if (value.length > 200 || value.trim() !== value || !virtualName.test(value) || value.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Use a relative virtual path with letters, numbers, periods, underscores, hyphens and slashes.');
  }
  return value;
}

function text(value: unknown, label: string, limit = 200): string {
  if (typeof value !== 'string' || !value.trim() || [...value].length > limit || surrogate.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`An OpenAPI ${label} exceeds the supported text policy.`);
  }
  return value;
}

function enforceStringBudget(root: unknown) {
  const pending = [root];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string' && (surrogate.test(value) || [...value].length > maxText)) {
      throw new Error('OpenAPI input contains a string beyond the 2,000 character limit.');
    }
    if (Array.isArray(value)) for (const child of value) pending.push(child);
    else if (record(value)) {
      for (const [key, child] of Object.entries(value)) {
        pending.push(key, child);
      }
    }
  }
}

/** Extract allowlisted declared operations. Raw descriptions and examples never leave the worker. */
export function readOpenApiFacts(
  bytes: ArrayBuffer, virtualPath: string, decode = (source: string) => decodeJson(source, 50_000, 'skip'),
): OpenApiFacts {
  validateVirtualPath(virtualPath);
  if (bytes.byteLength > maxBytes) throw new Error('Choose an OpenAPI file no larger than 2,000,000 bytes.');
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('Choose an OpenAPI file encoded as UTF-8.');
  }
  const base = decode(source);
  enforceStringBudget(base);
  if (!record(base) || typeof base.openapi !== 'string' || base.openapi.trim() !== base.openapi || !supportedVersion.test(base.openapi)) {
    throw new Error('Choose an OpenAPI 3.0 or 3.1 document.');
  }
  const sourcePaths = base.paths;
  if (!record(sourcePaths)) throw new Error('This OpenAPI document does not declare any paths in its root paths object.');
  const operations: OpenApiOperation[] = [];
  const keys = new Set<string>();
  let referencedPathCount = 0;
  for (const [path, item] of Object.entries(sourcePaths)) {
    if (path.startsWith('x-')) continue;
    text(path, 'path', 400);
    if (!path.startsWith('/') || !record(item)) throw new Error('An OpenAPI path entry is invalid.');
    if (Object.hasOwn(item, '$ref')) {
      referencedPathCount++;
      // This view cannot attest to operations when the Path Item itself has a reference.
      continue;
    }
    for (const method of methods) {
      if (!Object.hasOwn(item, method)) continue;
      const operation = item[method];
      if (!record(operation)) throw new Error(`A ${method.toUpperCase()} operation is malformed.`);
      const key = Object.hasOwn(operation, 'operationId') ? text(operation.operationId, 'operation ID') : `${method.toUpperCase()} ${path}`;
      if (keys.has(key)) throw new Error('OpenAPI operation identities must be unique.');
      keys.add(key);
      const tags = operation.tags;
      if (tags !== undefined && !Array.isArray(tags)) throw new Error('OpenAPI operation tags must be an array.');
      const typedTags = tags?.map(tag => text(tag, 'tag')) ?? [];
      if (typedTags.length > 100 || new Set(typedTags).size !== typedTags.length) throw new Error('An OpenAPI operation has too many or repeated tags.');
      const pointer = `/paths/${pointerToken(path)}/${method}`;
      operations.push({ key, method, path, tags: typedTags, pointer });
      if (operations.length > maxFacts) throw new Error('This file exceeds 10,000 supported operation facts.');
    }
  }
  const uncheckedSchemaCount = record(base.components) && record(base.components.schemas) ? Object.keys(base.components.schemas).length : 0;
  return { version: base.openapi, virtualPath, operations, referencedPathCount, uncheckedSchemaCount };
}
