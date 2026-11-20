import { decodeJson } from './decode-json';
import { decodeReferencePart, resolveAddress, virtualRoot } from './engineering-logical-path';
import { validateVirtualPath } from './openapi-facts';

const dialect = 'https://json-schema.org/draft/2020-12/schema';
const maxBytes = 2_000_000;
const maxReferenceWork = 10_000;
const maxString = 2_000;
const maxPointer = 500;
const anchorName = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const escapedToken = (value: string) => value.replaceAll('~', '~0').replaceAll('/', '~1');
const schemaMaps = ['$defs', 'properties', 'patternProperties', 'dependentSchemas'] as const;
const schemaLists = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const;
const schemaFields = [
  'items', 'contains', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems',
  'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema',
] as const;
const limitedSemantics = ['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else'] as const;

type JsonObject = Record<string, unknown>;
type Schema = JsonObject | boolean;
type Location = { virtualPath: string; pointer: string };

export type SchemaFile = { bytes: ArrayBuffer; virtualPath: string };
export type SchemaFact = Location & {
  key: string;
  label: string;
  kind: 'object' | 'property' | 'reference target';
  required: boolean;
};
export type SchemaLink = Location & {
  from: string;
  to: string;
  kind: 'Declared schema reference' | 'Declared property' | 'Declared required property';
};
export type UnresolvedSchemaRef = Location & { from: string; reason: string };
export type SchemaFacts = {
  facts: SchemaFact[];
  links: SchemaLink[];
  unresolved: UnresolvedSchemaRef[];
  checkedReferences: number;
  compositionCount: number;
};

type Resource = {
  id: string;
  virtualPath: string;
  pointer: string;
  anchors: Map<string, SchemaNode>;
};
type SchemaNode = Location & {
  schema: Schema;
  resource: Resource;
  property?: { label: string; owner: SchemaNode; required: boolean };
  name?: string;
};

function record(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readSchema(value: unknown): Schema {
  if (typeof value === 'boolean' || record(value)) return value;
  throw new Error('A JSON Schema entry must be an object or a boolean.');
}

function enforceStringBudget(root: unknown) {
  const pending = [root];
  while (pending.length) {
    const value = pending.pop();
    if (typeof value === 'string' && (/[\uD800-\uDFFF]/u.test(value) || [...value].length > maxString)) {
      throw new Error('JSON Schema contains invalid text or a string beyond 2,000 characters.');
    }
    if (Array.isArray(value)) for (const item of value) pending.push(item);
    else if (record(value)) for (const [key, item] of Object.entries(value)) pending.push(key, item);
  }
}

function pointerFromFragment(fragment: string) {
  return fragment.split('/').map(token => {
    if (/~(?![01])/.test(token)) throw new Error('A schema reference contains a malformed JSON Pointer escape.');
    return escapedToken(token.replaceAll('~1', '/').replaceAll('~0', '~'));
  }).join('/');
}

function logicalName(node: SchemaNode) {
  return node.resource.id + '#' + node.pointer.slice(node.resource.pointer.length);
}

function physicalName(virtualPath: string, pointer: string) {
  return virtualPath + '#' + pointer;
}

/** Extract declared one-hop relationships without expanding a referenced schema into its caller. */
export function readSchemaFacts(files: readonly SchemaFile[]): SchemaFacts {
  if (!files.length || files.length > 20 || files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > maxBytes) {
    throw new Error('Choose up to 20 JSON Schema files totaling at most 2,000,000 bytes.');
  }
  const paths = new Set<string>();
  const resources = new Map<string, Resource>();
  const nodes = new Map<string, SchemaNode>();
  const facts = new Map<string, SchemaFact>();
  const links: SchemaLink[] = [];
  const unresolved: UnresolvedSchemaRef[] = [];
  let checkedReferences = 0;
  let compositionCount = 0;
  let entriesRemaining = 50_000;

  function register(id: string, virtualPath: string, pointer: string): Resource {
    if (resources.has(id)) throw new Error('Two supplied schema resources share the same normalized ID.');
    const resource = { id, virtualPath, pointer, anchors: new Map<string, SchemaNode>() };
    resources.set(id, resource);
    return resource;
  }

  function collect(value: unknown, pointer: string, parent: Resource, info?: Pick<SchemaNode, 'property' | 'name'>) {
    if ([...pointer].length > maxPointer) throw new Error('A schema location exceeds the supported 500-character pointer limit.');
    const schema = readSchema(value);
    let resource = parent;
    if (record(schema)) {
      if (Object.hasOwn(schema, '$schema') && schema.$schema !== dialect && schema.$schema !== dialect + '#') {
        throw new Error('Choose JSON Schema draft 2020-12. A supplied schema declares a different dialect.');
      }
      if (Object.hasOwn(schema, '$id')) {
        const id = schema.$id;
        if (typeof id !== 'string' || !id || id.length > 500 || id.includes('#')) {
          throw new Error('A schema ID must be a nonempty URI of up to 500 characters without a fragment.');
        }
        const resolved = resolveAddress(id, parent.id);
        if (!resolved) throw new Error('A schema ID must resolve to an HTTP or HTTPS logical identifier.');
        if (resolved !== parent.id || pointer !== parent.pointer) resource = register(resolved, parent.virtualPath, pointer);
      }
    }
    const node: SchemaNode = { schema, resource, virtualPath: parent.virtualPath, pointer, ...info };
    nodes.set(physicalName(node.virtualPath, pointer), node);
    if (!record(schema)) return;
    if (Object.hasOwn(schema, '$anchor')) {
      const name = schema.$anchor;
      if (typeof name !== 'string' || name.length > 200 || !anchorName.test(name) || resource.anchors.has(name)) {
        throw new Error('A schema anchor is invalid or repeated in its logical resource.');
      }
      resource.anchors.set(name, node);
      node.name ??= name;
    }
    if (limitedSemantics.some(field => Object.hasOwn(schema, field))) compositionCount++;
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter(item => typeof item === 'string') : []);
    for (const field of schemaMaps) {
      const map = schema[field];
      if (!record(map)) continue;
      for (const [name, child] of Object.entries(map)) {
        const info = field === 'properties' ? { property: { label: name, owner: node, required: required.has(name) } }
          : field === '$defs' ? { name } : undefined;
        collect(child, `${pointer}/${field}/${escapedToken(name)}`, resource, info);
      }
    }
    for (const field of schemaLists) {
      const list = schema[field];
      if (Array.isArray(list)) list.forEach((child, index) => collect(child, `${pointer}/${field}/${index}`, resource));
    }
    for (const field of schemaFields) {
      if (Object.hasOwn(schema, field)) collect(schema[field], `${pointer}/${field}`, resource);
    }
  }

  for (const file of files) {
    const virtualPath = validateVirtualPath(file.virtualPath);
    if (paths.has(virtualPath)) throw new Error('Assign a distinct virtual path to every schema file.');
    paths.add(virtualPath);
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
    } catch {
      throw new Error('Choose schema files encoded as UTF-8.');
    }
    const root = decodeJson(source, entriesRemaining, 'skip', count => { entriesRemaining -= count; });
    enforceStringBudget(root);
    const resource = register(virtualRoot + '/' + virtualPath, virtualPath, '');
    collect(root, '', resource, { name: virtualPath });
    const primary = nodes.get(physicalName(virtualPath, ''))?.resource;
    if (primary && primary !== resource) resources.set(resource.id, primary);
  }

  function fact(node: SchemaNode): SchemaFact {
    const key = logicalName(node);
    const existing = facts.get(key);
    if (existing) return existing;
    const objectSchema = record(node.schema) && (node.schema.type === 'object' || record(node.schema.properties)
      || (Array.isArray(node.schema.type) && node.schema.type.includes('object')));
    const kind = node.property ? 'property' : objectSchema ? 'object' : 'reference target';
    const label = node.property?.label ?? node.name ?? (node.pointer.split('/').at(-1) || node.virtualPath);
    const item: SchemaFact = { key, label, kind, virtualPath: node.virtualPath, pointer: node.pointer, required: !!node.property?.required };
    facts.set(key, item);
    return item;
  }

  for (const node of nodes.values()) {
    const { schema, resource, virtualPath, pointer } = node;
    if (node.property) {
      links.push({
        from: fact(node.property.owner).key, to: fact(node).key, virtualPath, pointer,
        kind: node.property.required ? 'Declared required property' : 'Declared property',
      });
    } else if (!pointer || (node.name !== undefined && record(schema) && (schema.type === 'object' || record(schema.properties)))) {
      fact(node);
    }

    if (!record(schema)) continue;
    for (const keyword of ['$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor'] as const) {
      if (Object.hasOwn(schema, keyword)) {
        unresolved.push({ from: fact(node).key, virtualPath, pointer: pointer + '/' + keyword, reason: 'Unsupported dynamic or recursive semantics' });
      }
    }
    if (!Object.hasOwn(schema, '$ref')) continue;
    if (++checkedReferences > maxReferenceWork) throw new Error('This selection exceeds 10,000 reference resolutions.');
    const linkPointer = pointer + '/$ref';
    const from = fact(node).key;
    if (typeof schema.$ref !== 'string' || schema.$ref.length > 500) {
      unresolved.push({ from, virtualPath, pointer: linkPointer, reason: 'Unsupported reference form' });
      continue;
    }
    const hash = schema.$ref.indexOf('#');
    const address = hash < 0 ? schema.$ref : schema.$ref.slice(0, hash);
    const fragment = hash < 0 ? '' : decodeReferencePart(schema.$ref.slice(hash + 1));
    const id = resolveAddress(address, resource.id);
    const targetResource = id && resources.get(id);
    const relativePointer = fragment.startsWith('/') ? pointerFromFragment(fragment) : '';
    const target = targetResource && (fragment && !relativePointer
      ? targetResource.anchors.get(fragment)
      : nodes.get(physicalName(targetResource.virtualPath, targetResource.pointer + relativePointer)));
    if (target) {
      links.push({ from, to: fact(target).key, virtualPath, pointer: linkPointer, kind: 'Declared schema reference' });
    } else {
      unresolved.push({ from, virtualPath, pointer: linkPointer, reason: 'Target is not a registered schema location in the supplied files' });
    }
  }

  return { facts: [...facts.values()], links, unresolved, checkedReferences, compositionCount };
}
