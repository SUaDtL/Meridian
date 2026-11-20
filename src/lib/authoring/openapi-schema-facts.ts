type RecordValue = Record<string, unknown>;
type OpenApiSchema = { key: string; pointer: string };
type OpenApiReference = { from: string; to: string; pointer: string };

export type OpenApiSchemaFacts = {
  schemas: OpenApiSchema[];
  references: OpenApiReference[];
  unresolved: number;
  omitted: number;
};

const maxVisits = 10_000;
const rootPointer = '/components/schemas/';
const componentKey = /^[A-Za-z0-9_.-]{1,200}$/;
const modernDialects = new Set([
  undefined, 'https://spec.openapis.org/oas/3.1/dialect/base', 'https://json-schema.org/draft/2020-12/schema',
]);
const escapeToken = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);

function localComponent(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('#')) return undefined;
  try {
    const pointer = decodeURIComponent(value.slice(1));
    const key = pointer.startsWith(rootPointer) ? pointer.slice(rootPointer.length) : '';
    return componentKey.test(key) ? key : undefined;
  } catch {
    return undefined;
  }
}

/** Extract direct reference evidence without expanding a target or inspecting annotations. */
export function readOpenApiSchemaFacts(schemas: RecordValue, version: string, dialect: unknown): OpenApiSchemaFacts {
  const modern = version.startsWith('3.1.');
  const supportsDialect = !modern || ((typeof dialect === 'string' || dialect === undefined) && modernDialects.has(dialect));
  const values = Object.entries(schemas);
  if (values.length > maxVisits) throw new Error('This file exceeds 10,000 schema components.');
  const result: OpenApiSchemaFacts = { schemas: [], references: [], unresolved: 0, omitted: 0 };
  const eligible = new Set<string>();
  for (const [key, value] of values) {
    if (!componentKey.test(key) || !(record(value) || (modern && typeof value === 'boolean'))) {
      result.omitted++;
      continue;
    }
    result.schemas.push({ key, pointer: rootPointer + key });
    if (!modern || !record(value) || (!Object.hasOwn(value, '$id') && !Object.hasOwn(value, '$schema'))) eligible.add(key);
  }
  const singleKeywords = ['items', 'additionalProperties', 'not', ...(modern
    ? ['contains', 'if', 'then', 'else', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties'] : [])];
  const collectionKeywords = ['allOf', 'anyOf', 'oneOf', ...(modern ? ['prefixItems'] : [])];
  const mapKeywords = ['properties', ...(modern ? ['patternProperties', 'dependentSchemas', '$defs'] : [])];
  let visits = 0;

  function visit(value: unknown, from: string, pointer: string) {
    if (++visits > maxVisits) throw new Error('Schema reference analysis exceeded 10,000 visited locations.');
    if (pointer.length > 995) { result.omitted++; return; }
    if (!record(value)) {
      if (typeof value !== 'boolean') result.omitted++;
      return;
    }
    if (modern && (Object.hasOwn(value, '$id') || Object.hasOwn(value, '$schema'))) {
      result.omitted++;
      return;
    }
    if (Object.hasOwn(value, '$ref')) {
      const to = localComponent(value.$ref);
      if (to && eligible.has(to)) result.references.push({ from, to, pointer: pointer + '/$ref' });
      else result.unresolved++;
      if (!modern) return;
    }
    for (const keyword of ['$dynamicRef', '$recursiveRef']) {
      if (Object.hasOwn(value, keyword)) result.unresolved++;
    }
    for (const keyword of singleKeywords) {
      if (Object.hasOwn(value, keyword)) visit(value[keyword], from, `${pointer}/${keyword}`);
    }
    for (const keyword of collectionKeywords) {
      const children = value[keyword];
      if (Array.isArray(children)) children.forEach((child, index) => visit(child, from, `${pointer}/${keyword}/${index}`));
    }
    for (const keyword of mapKeywords) {
      const children = value[keyword];
      if (record(children)) Object.entries(children).forEach(([key, child]) => visit(child, from, `${pointer}/${keyword}/${escapeToken(key)}`));
    }
  }

  for (const { key, pointer } of result.schemas) {
    if (supportsDialect) visit(schemas[key], key, pointer);
    else result.omitted++;
  }
  return result;
}
