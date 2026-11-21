import { elementUuidPattern } from '../authoring/identities';
import { validateVirtualPath, verifyOpenApiOperationFact, type OpenApiFacts, type OpenApiOperation } from '../authoring/openapi-facts';
import { openApiNodeLimit, type OpenApiChoice } from '../authoring/openapi-project';
import schema from '../authoring/schemas/engineering-draft.schema.json';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';
import { draftBytes, draftWeek, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

type OperationScope = { facts: OpenApiFacts; selection: ReadonlyMap<string, OpenApiChoice>; title: string };
const invalid = () => new Error('The saved operations do not match their reviewed scope and source locations.');

function buildRecord({ facts, selection, title }: OperationScope, id: string, now: number) {
  if (!elementUuidPattern.test(id) || !Number.isFinite(now) || !/^3\.[01]\.\d+$/.test(facts.version) || facts.schemaView) throw invalid();
  if (facts.operations.length > 1_000) {
    throw new Error('A saved operations scope holds up to 1,000 facts. Previewing directly is still available.');
  }
  const virtualPath = validateVirtualPath(facts.virtualPath);
  const selectedFactIds: string[] = [];
  const selectedTags = new Set<string>();
  const pointers = new Set<string>();
  const keys = new Set<string>();
  const details: { factId: string; method: OpenApiOperation['method']; path: string; tags: string[]; primaryTagIndex: number | null }[] = [];
  const savedFacts = facts.operations.map((operation, index) => {
    verifyOpenApiOperationFact(operation);
    if (keys.has(operation.key) || pointers.has(operation.pointer)) throw invalid();
    keys.add(operation.key);
    pointers.add(operation.pointer);
    const factId = `o${index + 1}`;
    const choice = selection.get(operation.key);
    let primaryTagIndex: number | null = null;
    if (choice) {
      if (choice.key !== operation.key) throw invalid();
      selectedFactIds.push(factId);
      if (choice.tag !== null) {
        primaryTagIndex = operation.tags.indexOf(choice.tag);
        if (primaryTagIndex < 0) throw invalid();
        selectedTags.add(choice.tag);
      }
    }
    details.push({ factId, method: operation.method, path: operation.path, tags: operation.tags, primaryTagIndex });
    return { id: factId, externalKey: operation.key, label: choice?.label ?? '', kind: 'operation' as const, role: null,
      virtualPath, pointer: operation.pointer, parentId: null, status: 'resolved' as const, reason: '' };
  });
  if (selectedFactIds.length !== selection.size || selectedFactIds.length + selectedTags.size > openApiNodeLimit) {
    throw new Error('Review a scope of up to 100 operation and tag nodes before saving.');
  }
  const payload = {
    step: 'scope' as const, title, subtitle: '', adapter: 'openapi' as const, adapterVersion: '1.0.0', dialect: facts.version,
    virtualPaths: [virtualPath], facts: savedFacts, relationships: [], selectedFactIds, selectedRelationshipIds: [], unresolvedPolicy: 'exclude' as const,
    openApiOperations: { referencedPathCount: facts.referencedPathCount, uncheckedSchemaCount: facts.uncheckedSchemaCount, details },
  };
  if (!matchesBundledContract(payload, schema)) throw new Error('The extracted operations or display labels exceed their draft field limits.');
  return { schema: 'meridian-draft/v1' as const, feature: 'engineering-facts' as const, baseToken: null,
    id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + draftWeek).toISOString(), payload };
}

export type OpenApiOperationCheckpoint = ReturnType<typeof buildRecord>;

export function restoreOpenApiOperations({ payload }: OpenApiOperationCheckpoint): OperationScope {
  const [virtualPath] = payload.virtualPaths;
  const { details, referencedPathCount, uncheckedSchemaCount } = payload.openApiOperations;
  const wanted = new Set(payload.selectedFactIds);
  const selection = new Map<string, OpenApiChoice>();
  const operations = payload.facts.map((fact, index) => {
    const detail = details[index];
    if (fact.kind !== 'operation' || fact.virtualPath !== virtualPath || detail?.factId !== fact.id) throw invalid();
    const operation = { key: fact.externalKey, pointer: fact.pointer, method: detail.method, path: detail.path, tags: detail.tags };
    if (wanted.has(fact.id)) {
      const tag = detail.primaryTagIndex === null ? null : detail.tags[detail.primaryTagIndex];
      if (tag === undefined) throw invalid();
      selection.set(operation.key, { key: operation.key, label: fact.label, tag });
    }
    return operation;
  });
  return { facts: { version: payload.dialect, virtualPath, operations, referencedPathCount, uncheckedSchemaCount }, selection, title: payload.title };
}

export function readOpenApiOperationCheckpoint(value: unknown) {
  try {
    const record = value as OpenApiOperationCheckpoint;
    if (record?.feature !== 'engineering-facts' || record.payload?.adapter !== 'openapi' || !record.payload.openApiOperations
      || !matchesBundledContract(record.payload, schema) || draftBytes(record) > maxDraftBytes) return undefined;
    const expected = buildRecord(restoreOpenApiOperations(record), record.id, Date.parse(record.createdAt));
    return sameCheckpoint(record, expected) ? expected : undefined;
  } catch {
    return undefined;
  }
}

export function saveOpenApiOperationCheckpoint(db: IDBDatabase, state: OperationScope, previous?: OpenApiOperationCheckpoint) {
  const now = Date.now();
  const next = buildRecord(state, previous?.id ?? crypto.randomUUID(), now);
  return saveGuidedCheckpoint(db, next, previous, now);
}
