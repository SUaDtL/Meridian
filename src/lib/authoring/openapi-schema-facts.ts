import { decodeReferencePart, resolveAddress, virtualRoot } from './engineering-logical-path';

type RecordValue = Record<string, unknown>;
type Location = { virtualPath: string; pointer: string };
type OpenApiSchema = Location & { key: string; name: string };
type OpenApiReference = Location & { from: string; to: string };
export type OpenApiSchemaSource = { virtualPath: string; version: string; schemas: RecordValue; dialect: unknown };

export type OpenApiSchemaFacts = {
  schemas: OpenApiSchema[];
  references: OpenApiReference[];
  files: string[];
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

function referenceKey(value: unknown, base: string) {
  if (typeof value !== 'string') return undefined;
  const separator = value.indexOf('#');
  if (separator < 0) return undefined;
  try {
    const logicalFile = resolveAddress(value.slice(0, separator), `${virtualRoot}/${base}`);
    const pointer = decodeReferencePart(value.slice(separator + 1));
    const name = pointer.startsWith(rootPointer) ? pointer.slice(rootPointer.length) : '';
    return logicalFile?.startsWith(virtualRoot + '/') && componentKey.test(name)
      ? logicalFile.slice(virtualRoot.length + 1) + '#' + pointer : undefined;
  } catch {
    return undefined;
  }
}

/** Extract direct reference evidence without expanding a target or inspecting annotations. */
export function readOpenApiSchemaFacts(sources: readonly OpenApiSchemaSource[]): OpenApiSchemaFacts {
  const result: OpenApiSchemaFacts = { schemas: [], references: [], files: sources.map(source => source.virtualPath), unresolved: 0, omitted: 0 };
  const eligible = new Map<string, boolean>();
  const pending: { fact: OpenApiSchema; value: unknown; modern: boolean }[] = [];
  let count = 0;
  for (const { virtualPath, version, schemas, dialect } of sources) {
    const modern = version.startsWith('3.1.');
    const supportsDialect = !modern || ((typeof dialect === 'string' || dialect === undefined) && modernDialects.has(dialect));
    for (const [name, value] of Object.entries(schemas)) {
      if (++count > maxVisits) throw new Error('The supplied files exceed 10,000 schema components.');
      if (!componentKey.test(name) || !(record(value) || (modern && typeof value === 'boolean'))) {
        result.omitted++;
        continue;
      }
      const pointer = rootPointer + name;
      const key = virtualPath + '#' + pointer;
      const fact = { key, name, virtualPath, pointer };
      result.schemas.push(fact);
      if (!supportsDialect) { result.omitted++; continue; }
      if (!modern || !record(value) || (!Object.hasOwn(value, '$id') && !Object.hasOwn(value, '$schema'))) eligible.set(key, modern);
      pending.push({ fact, value, modern });
    }
  }
  let visits = 0;

  function visit(value: unknown, fact: OpenApiSchema, pointer: string, modern: boolean) {
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
      const to = referenceKey(value.$ref, fact.virtualPath);
      if (to && eligible.get(to) === modern) {
        result.references.push({ from: fact.key, to, virtualPath: fact.virtualPath, pointer: pointer + '/$ref' });
      }
      else result.unresolved++;
      if (!modern) return;
    }
    for (const keyword of ['$dynamicRef', '$recursiveRef']) {
      if (Object.hasOwn(value, keyword)) result.unresolved++;
    }
    const singleKeywords = modern ? modernSingle : commonSingle;
    for (const keyword of singleKeywords) {
      if (Object.hasOwn(value, keyword)) visit(value[keyword], fact, `${pointer}/${keyword}`, modern);
    }
    for (const keyword of modern ? modernCollections : commonCollections) {
      const children = value[keyword];
      if (Array.isArray(children)) children.forEach((child, index) => visit(child, fact, `${pointer}/${keyword}/${index}`, modern));
    }
    for (const keyword of modern ? modernMaps : commonMaps) {
      const children = value[keyword];
      if (record(children)) Object.entries(children).forEach(([key, child]) =>
        visit(child, fact, `${pointer}/${keyword}/${escapeToken(key)}`, modern));
    }
  }

  for (const { fact, value, modern } of pending) visit(value, fact, fact.pointer, modern);
  return result;
}

const commonSingle = ['items', 'additionalProperties', 'not'];
const modernSingle = [...commonSingle, 'contains', 'if', 'then', 'else', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties'];
const commonCollections = ['allOf', 'anyOf', 'oneOf'];
const modernCollections = [...commonCollections, 'prefixItems'];
const commonMaps = ['properties'];
const modernMaps = [...commonMaps, 'patternProperties', 'dependentSchemas', '$defs'];
