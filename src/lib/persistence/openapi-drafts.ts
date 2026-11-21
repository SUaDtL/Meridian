import { elementUuidPattern } from '../authoring/identities';
import { validateVirtualPath, type OpenApiFacts } from '../authoring/openapi-facts';
import { openApiSchemaScope, type OpenApiSchemaChoice } from '../authoring/openapi-project';
import { unresolvedOpenApiReasons, type OpenApiSchemaFacts } from '../authoring/openapi-schema-facts';
import schema from '../authoring/schemas/engineering-draft.schema.json';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';
import { draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';
import { readOpenApiOperationCheckpoint, type OpenApiOperationCheckpoint } from './openapi-operation-drafts';

const adapterVersion = '1.0.0';
const componentPointer = /^\/components\/schemas\/([A-Za-z0-9_.-]{1,200})$/;
const version = /^3\.[01]\.\d+$/;
type ScopeState = { facts: OpenApiFacts; selection: ReadonlyMap<string, OpenApiSchemaChoice>; title: string; includeUnresolved: boolean };
type SavedFact = {
  id: string; externalKey: string; label: string; kind: 'schema' | 'unresolved'; role: null;
  virtualPath: string; pointer: string; parentId: string | null; status: 'resolved' | 'unresolved'; reason: string;
};

function buildRecord({ facts, selection, title, includeUnresolved }: ScopeState, id: string, now: number) {
  const view = facts.schemaView;
  if (!view || !elementUuidPattern.test(id) || !Number.isFinite(now) || !version.test(facts.version)) {
    throw new Error('OpenAPI schema facts are needed to save this scope.');
  }
  if (view.schemas.length + view.unresolved.length > 1_000 || view.references.length > 2_000) {
    throw new Error('A saved scope holds up to 1,000 extracted facts and 2,000 references. Previewing directly is still available.');
  }
  const scope = openApiSchemaScope(facts, selection, includeUnresolved);
  if (scope.schemas.length !== selection.size || selection.size > 100 || scope.references.length > 200) {
    throw new Error('Review up to 100 selected schemas and 200 selected references before saving a scope.');
  }
  const ids = new Map(view.schemas.map((fact, index) => [fact.key, `s${index + 1}`]));
  const selectedFactIds = scope.schemas.map(item => ids.get(item.key)!);
  const wanted = new Set(selectedFactIds);
  const savedFacts: SavedFact[] = view.schemas.map(({ key, name, virtualPath, pointer }) => ({
    id: ids.get(key)!, externalKey: key, label: selection.get(key)?.label ?? name, kind: 'schema', role: null,
    virtualPath, pointer, parentId: null, status: 'resolved', reason: '',
  }));
  for (const [index, item] of view.unresolved.entries()) {
    savedFacts.push({ id: `u${index + 1}`, externalKey: `${item.virtualPath}#${item.pointer}`, label: 'Unresolved schema reference',
      kind: 'unresolved', role: null, virtualPath: item.virtualPath, pointer: item.pointer, parentId: ids.get(item.from)!,
      status: 'unresolved', reason: item.reason });
  }
  const relationships = view.references.map(({ from, to, virtualPath, pointer }, index) => ({
    id: `r${index + 1}`, sourceId: ids.get(from)!, targetId: ids.get(to)!, type: 'reference' as const, virtualPath, pointer,
  }));
  const payload = {
    step: 'scope' as const, title, subtitle: '', adapter: 'openapi' as const, adapterVersion, dialect: facts.version,
    virtualPaths: view.files, facts: savedFacts, relationships, selectedFactIds,
    selectedRelationshipIds: relationships.filter(item => wanted.has(item.sourceId) && wanted.has(item.targetId)).map(item => item.id),
    unresolvedPolicy: includeUnresolved ? 'placeholders' as const : 'exclude' as const,
  };
  if (!matchesBundledContract(payload, schema)) throw new Error('The extracted scope exceeds its draft field limits.');
  return { schema: 'meridian-draft/v1' as const, feature: 'engineering-facts' as const, baseToken: null,
    id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + draftWeek).toISOString(), payload };
}

type OpenApiSchemaCheckpoint = ReturnType<typeof buildRecord>;
export type OpenApiCheckpoint = OpenApiSchemaCheckpoint | OpenApiOperationCheckpoint;

export function isOpenApiOperationCheckpoint(checkpoint: OpenApiCheckpoint): checkpoint is OpenApiOperationCheckpoint {
  return 'openApiOperations' in checkpoint.payload;
}

export function restoreOpenApiScope({ payload }: OpenApiSchemaCheckpoint): ScopeState {
  const files = new Set(payload.virtualPaths.map(validateVirtualPath));
  if (!files.size || files.size !== payload.virtualPaths.length) throw new Error('Saved schema facts need distinct virtual paths.');
  const view: OpenApiSchemaFacts = { schemas: [], references: [], unresolved: [], files: [...files], omitted: 0, unsupportedDialects: [] };
  const idToSchema = new Map<string, OpenApiSchemaFacts['schemas'][number]>();
  const schemaKeys = new Set<string>();
  const wanted = new Set(payload.selectedFactIds);
  const selection = new Map<string, OpenApiSchemaChoice>();
  for (const item of payload.facts) {
    if (!files.has(item.virtualPath) || item.externalKey !== `${item.virtualPath}#${item.pointer}`) {
      throw new Error('Saved schema facts have an unavailable source location.');
    }
    if (item.kind !== 'schema') continue;
    const name = componentPointer.exec(item.pointer)?.[1];
    if (!name || idToSchema.has(item.id) || schemaKeys.has(item.externalKey)) throw new Error('Saved schemas need distinct named component locations.');
    const fact = { key: item.externalKey, virtualPath: item.virtualPath, pointer: item.pointer, name };
    idToSchema.set(item.id, fact);
    schemaKeys.add(fact.key);
    view.schemas.push(fact);
    if (wanted.has(item.id)) selection.set(fact.key, { key: fact.key, label: item.label });
  }
  for (const { kind, parentId, virtualPath, pointer, reason } of payload.facts) {
    if (kind !== 'unresolved') continue;
    const from = parentId && idToSchema.get(parentId);
    const category = unresolvedOpenApiReasons.find(candidate => candidate === reason);
    if (!from || from.virtualPath !== virtualPath || !pointer.startsWith(from.pointer + '/') || !category) {
      throw new Error('An unresolved fact has an invalid source or reason.');
    }
    view.unresolved.push({ from: from.key, virtualPath, pointer, reason: category });
  }
  for (const item of payload.relationships) {
    const from = idToSchema.get(item.sourceId);
    const to = idToSchema.get(item.targetId);
    if (!from || !to || from.virtualPath !== item.virtualPath || !item.pointer.startsWith(from.pointer + '/')
      || !item.pointer.endsWith('/$ref')) throw new Error('A saved schema reference is unavailable.');
    view.references.push({ from: from.key, to: to.key, virtualPath: item.virtualPath, pointer: item.pointer });
  }
  return { facts: { version: payload.dialect, virtualPath: view.files[0], operations: [], referencedPathCount: 0,
    uncheckedSchemaCount: view.schemas.length, schemaView: view },
    title: payload.title, selection, includeUnresolved: payload.unresolvedPolicy === 'placeholders' };
}

function readSchemaCheckpoint(value: unknown) {
  try {
    const record = value as OpenApiSchemaCheckpoint;
    if (record?.feature !== 'engineering-facts' || record.payload?.adapter !== 'openapi' || !matchesBundledContract(record.payload, schema)
      || draftBytes(record) > maxDraftBytes) return undefined;
    const expected = buildRecord(restoreOpenApiScope(record), record.id, Date.parse(record.createdAt));
    return sameCheckpoint(record, expected) ? expected : undefined;
  } catch {
    return undefined;
  }
}

export function listOpenApiCheckpoints(db: IDBDatabase) {
  return listGuidedCheckpoints<OpenApiCheckpoint>(db, value => readOpenApiOperationCheckpoint(value) ?? readSchemaCheckpoint(value));
}

export function saveOpenApiCheckpoint(db: IDBDatabase, state: ScopeState, previous?: OpenApiSchemaCheckpoint) {
  const now = Date.now();
  const next = buildRecord(state, previous?.id ?? crypto.randomUUID(), now);
  return saveGuidedCheckpoint(db, next, previous, now);
}
