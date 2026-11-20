import { isAlias, isMap, isScalar, isSeq, parseDocument } from 'yaml';

const coreTags = new Set(['map', 'seq', 'str', 'bool', 'null', 'int', 'float'].map(tag => `tag:yaml.org,2002:${tag}`));
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor', '<<']);
const maxEntries = 50_000;
const maxDepth = 64;

function invalid() {
  return new Error('Choose one valid YAML 1.2 document with string mapping keys.');
}

/** Resolve only YAML data in the worker. Aliases and custom tags never reach object conversion. */
export function readRestrictedOpenApiYaml(source: string): unknown {
  let document: ReturnType<typeof parseDocument>;
  try {
    document = parseDocument(source, {
      version: '1.2', schema: 'core', merge: false, strict: true, uniqueKeys: true, intAsBigInt: true,
    });
  } catch {
    throw invalid();
  }
  if (document.errors.some(error => error.code === 'MULTIPLE_DOCS')) throw new Error('OpenAPI YAML must contain one document.');
  if (document.errors.some(error => error.code === 'DUPLICATE_KEY')) throw new Error('OpenAPI YAML contains a repeated mapping key.');
  if (document.errors.length) throw invalid();
  const directives = document.directives;
  if (document.warnings.length || directives?.yaml.version !== '1.2'
    || Object.entries(directives.tags).some(([key, prefix]) => key !== '!!' || prefix !== 'tag:yaml.org,2002:')) {
    throw new Error('OpenAPI YAML supports standard YAML 1.2 tags only.');
  }
  let entries = 0;
  function decode(node: unknown, depth: number): unknown {
    if (depth > maxDepth || ++entries > maxEntries) {
      throw new Error('OpenAPI YAML exceeds the supported depth or 50,000-entry limit.');
    }
    if (node === null) return null;
    if (isAlias(node)) throw new Error('OpenAPI YAML aliases are unsupported.');
    if ((isMap(node) || isSeq(node) || isScalar(node)) && node.tag !== undefined && !coreTags.has(node.tag)) {
      throw new Error('OpenAPI YAML supports standard YAML 1.2 tags only.');
    }
    if (isMap(node)) {
      const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const { key, value } of node.items) {
        const name = decode(key, depth + 1);
        if (typeof name !== 'string' || forbiddenKeys.has(name)) throw invalid();
        if (Object.hasOwn(values, name)) throw new Error('OpenAPI YAML contains a repeated mapping key.');
        values[name] = decode(value, depth + 1);
      }
      return values;
    }
    if (isSeq(node)) return node.items.map(item => decode(item, depth + 1));
    if (isScalar(node)) {
      const { value } = node;
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
      // Operation extraction does not read numeric payload fields.
      if (typeof value === 'number' || typeof value === 'bigint') return null;
    }
    throw invalid();
  }
  return decode(document.contents, 0);
}
