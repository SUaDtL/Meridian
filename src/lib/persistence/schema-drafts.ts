import { elementUuidPattern } from '../authoring/identities';
import { validateVirtualPath } from '../authoring/openapi-facts';
import type { SchemaFact, SchemaFacts, SchemaLink } from '../authoring/schema-facts';
import contract from '../authoring/schemas/engineering-draft.schema.json';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';
import { draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

type Scope = { facts: SchemaFacts; selection: ReadonlyMap<string, string>; includeUnresolved: boolean };
type FactKind = 'schema' | 'property' | 'unresolved';
type Status = 'resolved' | 'unresolved';
const title = 'JSON Schema relationships';
const locationKey = ({ virtualPath, pointer }: { virtualPath: string; pointer: string }) => virtualPath + '#' + pointer;
const pointerFormat = /^(?:\/(?:[^~\/]|~[01])*)*$/u;
const reasons = new Set([
  'Unsupported dynamic or recursive semantics',
  'Unsupported reference form',
  'Target is not a registered schema location in the supplied files',
]);

function buildRecord({ facts, selection, includeUnresolved }: Scope, id: string, now: number) {
  if (!elementUuidPattern.test(id) || !Number.isFinite(now)) throw new Error('This schema draft is invalid.');
  if (facts.facts.length + facts.unresolved.length > 1_000 || facts.links.length > 2_000) {
    throw new Error('A saved scope holds up to 1,000 extracted facts and 2,000 relationships. Previewing directly is still available.');
  }
  const ids = new Map(facts.facts.map((fact, index) => [fact.key, `s${index + 1}`]));
  const selectedFactIds = facts.facts.filter(item => selection.has(item.key)).map(item => ids.get(item.key)!);
  const wanted = new Set(selectedFactIds);
  const savedFacts = facts.facts.map(item => ({
    id: ids.get(item.key)!, externalKey: locationKey(item), label: selection.get(item.key) ?? item.label,
    kind: (item.kind === 'property' ? 'property' : 'schema') as FactKind, role: null,
    virtualPath: item.virtualPath, pointer: item.pointer, parentId: null as string | null,
    status: 'resolved' as Status,
    reason: item.required ? 'required-property' : item.kind === 'reference target' ? 'reference-target' : '',
  }));
  for (const [index, item] of facts.unresolved.entries()) {
    savedFacts.push({ id: `u${index + 1}`, externalKey: locationKey(item), label: 'Unresolved schema reference',
      kind: 'unresolved', role: null, virtualPath: item.virtualPath, pointer: item.pointer, parentId: ids.get(item.from)!,
      status: 'unresolved', reason: item.reason });
  }
  const relationships = facts.links.map((item, index) => ({
    id: `r${index + 1}`, sourceId: ids.get(item.from)!, targetId: ids.get(item.to)!,
    type: item.kind === 'Declared schema reference' ? 'reference' as const : 'property' as const,
    virtualPath: item.virtualPath, pointer: item.pointer,
  }));
  const selectedRelationshipIds = relationships.filter(item => wanted.has(item.sourceId) && wanted.has(item.targetId)).map(item => item.id);
  if (selectedFactIds.length !== selection.size || selection.size > 100 || selectedRelationshipIds.length > 200) {
    throw new Error('Review up to 100 selected facts and 200 selected relationships before saving.');
  }
  const payload = {
    step: 'scope' as const, title, subtitle: '', adapter: 'json-schema' as const, adapterVersion: '1.0.0', dialect: '2020-12',
    virtualPaths: [...new Set(facts.facts.map(item => validateVirtualPath(item.virtualPath)))],
    facts: savedFacts, relationships, selectedFactIds, selectedRelationshipIds,
    unresolvedPolicy: includeUnresolved ? 'placeholders' as const : 'exclude' as const,
  };
  if (!matchesBundledContract(payload, contract)) throw new Error('The extracted schema exceeds its draft field limits.');
  return { schema: 'meridian-draft/v1' as const, feature: 'engineering-facts' as const, baseToken: null,
    id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + draftWeek).toISOString(), payload };
}

export type SchemaCheckpoint = ReturnType<typeof buildRecord>;

export function restoreSchemaScope({ payload }: SchemaCheckpoint): Scope {
  const paths = new Set(payload.virtualPaths.map(validateVirtualPath));
  const facts: SchemaFacts = { facts: [], links: [], unresolved: [], checkedReferences: 0, compositionCount: 0 };
  const byId = new Map<string, SchemaFact>();
  const keys = new Set<string>();
  const selected = new Set(payload.selectedFactIds);
  const selection = new Map<string, string>();
  for (const item of payload.facts) {
    if (item.externalKey !== locationKey(item) || !paths.has(item.virtualPath) || !pointerFormat.test(item.pointer)
      || keys.has(item.externalKey)) throw new Error('A saved schema location is invalid or repeated.');
    keys.add(item.externalKey);
    if (item.kind === 'unresolved') continue;
    if (byId.has(item.id)) throw new Error('A saved schema identity is repeated.');
    const fact: SchemaFact = { key: item.externalKey, label: item.label, virtualPath: item.virtualPath, pointer: item.pointer,
      kind: item.kind === 'property' ? 'property' : item.reason === 'reference-target' ? 'reference target' : 'object',
      required: item.reason === 'required-property' };
    byId.set(item.id, fact);
    facts.facts.push(fact);
    if (selected.has(item.id)) selection.set(fact.key, item.label);
  }
  for (const item of payload.facts) {
    if (item.kind !== 'unresolved') continue;
    const source = byId.get(item.parentId ?? '');
    const keyword = source && item.pointer.slice(source.pointer.length);
    if (!source || source.virtualPath !== item.virtualPath || !item.pointer.startsWith(source.pointer)
      || !reasons.has(item.reason) || !/^\/\$(?:ref|dynamicRef|dynamicAnchor|recursiveRef|recursiveAnchor)$/.test(keyword ?? '')) {
      throw new Error('An unresolved schema location is invalid.');
    }
    facts.unresolved.push({ from: source.key, virtualPath: item.virtualPath, pointer: item.pointer, reason: item.reason });
  }
  const links = new Set<string>();
  for (const item of payload.relationships) {
    const source = byId.get(item.sourceId);
    const target = byId.get(item.targetId);
    const key = locationKey(item);
    if (!source || !target || item.virtualPath !== source.virtualPath || links.has(key)) {
      throw new Error('A saved schema relationship is invalid or repeated.');
    }
    let kind: SchemaLink['kind'];
    if (item.type === 'reference' && item.pointer === source.pointer + '/$ref') kind = 'Declared schema reference';
    else if (item.type === 'property' && target.kind === 'property' && target.virtualPath === item.virtualPath
      && target.pointer === item.pointer && item.pointer.startsWith(source.pointer + '/properties/')
      && !item.pointer.slice(source.pointer.length + '/properties/'.length).includes('/')) {
      kind = target.required ? 'Declared required property' : 'Declared property';
    } else throw new Error('A saved schema relationship has an invalid location or type.');
    links.add(key);
    facts.links.push({ from: source.key, to: target.key, virtualPath: item.virtualPath, pointer: item.pointer, kind });
  }
  facts.checkedReferences = facts.links.filter(item => item.kind === 'Declared schema reference').length
    + facts.unresolved.filter(item => item.pointer.endsWith('/$ref')).length;
  return { facts, selection, includeUnresolved: payload.unresolvedPolicy === 'placeholders' };
}

function readCheckpoint(value: unknown) {
  try {
    const record = value as SchemaCheckpoint;
    if (record?.feature !== 'engineering-facts' || record.payload?.adapter !== 'json-schema'
      || !matchesBundledContract(record.payload, contract) || draftBytes(record) > maxDraftBytes) return undefined;
    const rebuilt = buildRecord(restoreSchemaScope(record), record.id, Date.parse(record.createdAt));
    return sameCheckpoint(record, rebuilt) ? rebuilt : undefined;
  } catch {
    return undefined;
  }
}

export function listSchemaCheckpoints(db: IDBDatabase) {
  return listGuidedCheckpoints(db, readCheckpoint);
}

export function saveSchemaCheckpoint(db: IDBDatabase, scope: Scope, previous?: SchemaCheckpoint) {
  const now = Date.now();
  return saveGuidedCheckpoint(db, buildRecord(scope, previous?.id ?? crypto.randomUUID(), now), previous, now);
}
