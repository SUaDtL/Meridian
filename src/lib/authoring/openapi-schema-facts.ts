import { decodeReferencePart, resolveAddress, virtualRoot } from './engineering-logical-path';

type RecordValue = Record<string, unknown>;
type Location = { virtualPath: string; pointer: string };
type OpenApiSchema = Location & { key: string; name: string };
type OpenApiReference = Location & { from: string; to: string };
export const unresolvedOpenApiReasons = ['Unsupported reference form', 'Target component unavailable in supplied files',
  'Unsupported target schema semantics', 'Unsupported dynamic or recursive reference'] as const;
type UnresolvedReason = typeof unresolvedOpenApiReasons[number];
type UnresolvedReference = Location & { from: string; reason: UnresolvedReason };
export type OpenApiSchemaSource = { virtualPath: string; version: string; schemas: RecordValue; dialect: unknown };

export type OpenApiSchemaFacts = {
  schemas: OpenApiSchema[];
  references: OpenApiReference[];
  files: string[];
  unresolved: UnresolvedReference[];
  omitted: number;
};

const maxVisits = 10_000;
const rootPointer = '/components/schemas/';
const anchorName = /^[A-Za-z_][A-Za-z0-9_.-]{0,199}$/;
const componentKey = /^[A-Za-z0-9_.-]{1,200}$/;
const modernDialects = new Set<unknown>([
  undefined, 'https://spec.openapis.org/oas/3.1/dialect/base', 'https://json-schema.org/draft/2020-12/schema',
  'https://json-schema.org/draft/2020-12/schema#',
]);
const escapeToken = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);

type Resource = { file?: string; root?: string; anchors: Map<string, string> };

function referenceKey(value: unknown, base: string, modern: boolean, resources: ReadonlyMap<string, Resource>) {
  if (typeof value !== 'string' || value.length > 2_000) return undefined;
  const separator = value.indexOf('#');
  try {
    const address = resolveAddress(separator < 0 ? value : value.slice(0, separator), base);
    const fragment = separator < 0 ? '' : decodeReferencePart(value.slice(separator + 1));
    if (!address) return undefined;
    const resource = resources.get(address);
    if (fragment.startsWith(rootPointer)) {
      const name = fragment.slice(rootPointer.length);
      if (!componentKey.test(name)) return undefined;
      return resource?.file ? { key: resource.file + '#' + fragment } : {};
    }
    if (!modern) return undefined;
    if (!fragment) return { key: resource?.root };
    return anchorName.test(fragment) ? { key: resource?.anchors.get(fragment) } : undefined;
  } catch {
    return undefined;
  }
}

/** Extract direct reference evidence without expanding a target or inspecting annotations. */
export function readOpenApiSchemaFacts(sources: readonly OpenApiSchemaSource[]): OpenApiSchemaFacts {
  const result: OpenApiSchemaFacts = { schemas: [], references: [], files: sources.map(source => source.virtualPath), unresolved: [], omitted: 0 };
  const resources = new Map<string, Resource>();
  const definitions = new Map<string, boolean | null>();
  const pending: { fact: OpenApiSchema; value: unknown; modern: boolean; base: string }[] = [];
  for (const { virtualPath } of sources) resources.set(`${virtualRoot}/${virtualPath}`, { file: virtualPath, anchors: new Map() });
  let count = 0;
  for (const { virtualPath, version, schemas, dialect } of sources) {
    const modern = version.startsWith('3.1.');
    const supportsDialect = !modern || modernDialects.has(dialect);
    const location = `${virtualRoot}/${virtualPath}`;
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
      definitions.set(key, null);
      if (!supportsDialect || (modern && record(value) && Object.hasOwn(value, '$schema')
        && !modernDialects.has(value.$schema))) {
        result.omitted++;
        continue;
      }
      let base = location;
      if (modern && record(value) && Object.hasOwn(value, '$id')) {
        const id = value.$id;
        if (typeof id !== 'string' || !id || id.length > 500 || id.includes('#')) {
          throw new Error('An OpenAPI schema ID must be a nonempty URI of up to 500 characters without a fragment.');
        }
        const resolved = resolveAddress(id, location);
        if (!resolved) throw new Error('An OpenAPI schema ID must resolve to an HTTP or HTTPS logical identifier.');
        if (resources.has(resolved)) throw new Error('Two supplied OpenAPI resources share the same normalized ID.');
        base = resolved;
        resources.set(base, { root: key, anchors: new Map() });
      }
      if (modern && record(value) && Object.hasOwn(value, '$anchor')) {
        const anchor = value.$anchor;
        const anchors = resources.get(base)!.anchors;
        if (typeof anchor !== 'string' || !anchorName.test(anchor) || anchors.has(anchor)) {
          throw new Error('An OpenAPI schema anchor is invalid or repeated in its logical resource.');
        }
        anchors.set(anchor, key);
      }
      definitions.set(key, modern);
      pending.push({ fact, value, modern, base });
    }
  }
  let visits = 0;

  function requireReferenceBudget() {
    if (result.references.length + result.unresolved.length >= maxVisits) {
      throw new Error('Schema reference analysis exceeded 10,000 extracted references.');
    }
  }

  function unresolved(fact: OpenApiSchema, pointer: string, reason: UnresolvedReason) {
    if (pointer.length > 1_000) { result.omitted++; return; }
    requireReferenceBudget();
    result.unresolved.push({ from: fact.key, virtualPath: fact.virtualPath, pointer, reason });
  }

  function visit(value: unknown, fact: OpenApiSchema, pointer: string, modern: boolean, base: string) {
    if (++visits > maxVisits) throw new Error('Schema reference analysis exceeded 10,000 visited locations.');
    if (pointer.length > 995) { result.omitted++; return; }
    if (!record(value)) {
      if (typeof value !== 'boolean') result.omitted++;
      return;
    }
    if (modern && pointer !== fact.pointer && (Object.hasOwn(value, '$id') || Object.hasOwn(value, '$schema') || Object.hasOwn(value, '$anchor'))) {
      result.omitted++;
      return;
    }
    if (Object.hasOwn(value, '$ref')) {
      const resolved = referenceKey(value.$ref, base, modern, resources);
      const to = resolved?.key;
      if (to && definitions.get(to) === modern) {
        requireReferenceBudget();
        result.references.push({ from: fact.key, to, virtualPath: fact.virtualPath, pointer: pointer + '/$ref' });
      }
      else unresolved(fact, pointer + '/$ref', !resolved ? 'Unsupported reference form'
        : to && definitions.has(to) ? 'Unsupported target schema semantics' : 'Target component unavailable in supplied files');
      if (!modern) return;
    }
    for (const keyword of ['$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor']) {
      if (Object.hasOwn(value, keyword)) unresolved(fact, `${pointer}/${keyword}`, 'Unsupported dynamic or recursive reference');
    }
    const singleKeywords = modern ? modernSingle : commonSingle;
    for (const keyword of singleKeywords) {
      if (Object.hasOwn(value, keyword)) visit(value[keyword], fact, `${pointer}/${keyword}`, modern, base);
    }
    for (const keyword of modern ? modernCollections : commonCollections) {
      const children = value[keyword];
      if (Array.isArray(children)) children.forEach((child, index) => visit(child, fact, `${pointer}/${keyword}/${index}`, modern, base));
    }
    for (const keyword of modern ? modernMaps : commonMaps) {
      const children = value[keyword];
      if (record(children)) Object.entries(children).forEach(([key, child]) =>
        visit(child, fact, `${pointer}/${keyword}/${escapeToken(key)}`, modern, base));
    }
  }

  for (const { fact, value, modern, base } of pending) visit(value, fact, fact.pointer, modern, base);
  return result;
}

const commonSingle = ['items', 'additionalProperties', 'not'];
const modernSingle = [...commonSingle, 'contains', 'if', 'then', 'else', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties'];
const commonCollections = ['allOf', 'anyOf', 'oneOf'];
const modernCollections = [...commonCollections, 'prefixItems'];
const commonMaps = ['properties'];
const modernMaps = [...commonMaps, 'patternProperties', 'dependentSchemas', '$defs'];
