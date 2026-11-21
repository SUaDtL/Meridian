import { elementUuidPattern } from '../authoring/identities';
import { validateVirtualPath } from '../authoring/openapi-facts';
import schema from '../authoring/schemas/engineering-draft.schema.json';
import { terraformResourceModule, type TerraformFacts } from '../authoring/terraform-facts';
import { terraformScope } from '../authoring/terraform-project';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';
import { draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

const index = '(?:0|[1-9][0-9]*)';
const resourcePointer = new RegExp(`^(?:/child_modules/${index})*/resources/${index}$`);
const relationshipPointer = new RegExp(`^/resources/${index}/(?:depends_on/${index}|expressions/[A-Za-z_][A-Za-z0-9_-]*/references/${index})$`);
type Scope = { facts: TerraformFacts; selection: ReadonlySet<string>; includeReferences: boolean };

function record({ facts, selection, includeReferences }: Scope, id: string, now: number) {
  const { virtualPath, planned } = facts;
  validateVirtualPath(virtualPath);
  if (!Number.isFinite(now) || !elementUuidPattern.test(id)) throw new Error('This inventory draft is invalid.');
  if (facts.resources.length > 1_000 || facts.references.length > 2_000) {
    throw new Error('A saved scope holds up to 1,000 extracted resources and 2,000 references. Previewing directly is still available.');
  }
  const scope = terraformScope(facts, selection, includeReferences);
  if (scope.resources.length !== selection.size || selection.size > 100 || scope.references.length > 200) {
    throw new Error('Review up to 100 selected resources and 200 selected references before saving a scope.');
  }
  const keys = new Map(facts.resources.map(({ address }, offset) => [address, `f${offset + 1}`]));
  const selectedPairs = new Set(scope.references);
  const savedFacts = facts.resources.map(({ address, pointer }) => ({
    id: keys.get(address)!, externalKey: address, label: address, kind: 'resource' as const, role: null,
    virtualPath, pointer, parentId: null, status: 'resolved' as const, reason: '',
  }));
  const relationships = facts.references.map(({ source, target, pointer }, offset) => ({
    id: `r${offset + 1}`, sourceId: keys.get(source)!, targetId: keys.get(target)!,
    type: 'declared-dependency' as const, virtualPath, pointer,
  }));
  const payload = {
    step: 'scope' as const, title: planned ? 'Terraform planned resource inventory' : 'Terraform state resource inventory',
    subtitle: '', adapter: 'terraform-show' as const, adapterVersion: '1.0.0', dialect: planned ? '1.x plan' : '1.x state',
    virtualPaths: [virtualPath], facts: savedFacts, relationships, selectedFactIds: scope.resources.map(item => keys.get(item.address)!),
    selectedRelationshipIds: relationships.filter((_, offset) => selectedPairs.has(facts.references[offset])).map(item => item.id),
    unresolvedPolicy: 'exclude' as const,
  };
  if (!matchesBundledContract(payload, schema)) throw new Error('The extracted inventory exceeds its draft field limits.');
  return { schema: 'meridian-draft/v1' as const, feature: 'engineering-facts' as const, baseToken: null,
    id, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + draftWeek).toISOString(), payload };
}

export type TerraformCheckpoint = ReturnType<typeof record>;

export function restoreTerraformScope({ payload }: TerraformCheckpoint): Scope {
  const virtualPath = validateVirtualPath(payload.virtualPaths[0] ?? '');
  const planned = payload.dialect === '1.x plan';
  const root = `/${planned ? 'planned_values' : 'values'}/root_module`;
  const facts: TerraformFacts = { virtualPath, planned, hasConfiguration: payload.relationships.length > 0,
    unmatchedConfiguration: 0, omitted: 0, unresolved: 0, resources: [], references: [] };
  const addresses = new Set<string>();
  const byId = new Map<string, TerraformFacts['resources'][number]>();
  const wanted = new Set(payload.selectedFactIds);
  const selection = new Set<string>();
  for (const { id, externalKey: address, virtualPath: path, pointer } of payload.facts) {
    const module = terraformResourceModule(address);
    const location = pointer.slice(root.length);
    if (module === undefined || !pointer.startsWith(root) || !resourcePointer.test(location)
      || (location.match(/\/child_modules\//g)?.length ?? 0) !== (module?.split('.').length ?? 0) / 2
      || path !== virtualPath || addresses.has(address) || byId.has(id)) {
      throw new Error('A saved resource address or source location is invalid.');
    }
    const item = { address, module, pointer };
    facts.resources.push(item);
    byId.set(id, item);
    addresses.add(address);
    if (wanted.has(id)) selection.add(address);
  }
  const pairs = new Set<string>();
  for (const { sourceId, targetId, virtualPath: path, pointer } of payload.relationships) {
    const from = byId.get(sourceId);
    const to = byId.get(targetId);
    const prefix = '/configuration/root_module' + (from?.module?.split('.').filter((_, offset) => offset % 2 === 1)
      .map(name => `/module_calls/${name}/module`).join('') ?? '');
    const pair = JSON.stringify([sourceId, targetId]);
    if (!from || !to || path !== virtualPath || !pointer.startsWith(prefix) || !relationshipPointer.test(pointer.slice(prefix.length))
      || from.module?.includes('[') || pairs.has(pair)) throw new Error('A declared reference has an invalid source location.');
    pairs.add(pair);
    facts.references.push({ source: from.address, target: to.address, pointer });
  }
  return { facts, selection, includeReferences: payload.selectedRelationshipIds.length > 0 };
}

function readCheckpoint(value: unknown) {
  try {
    const saved = value as TerraformCheckpoint;
    if (saved?.feature !== 'engineering-facts' || saved.payload?.adapter !== 'terraform-show'
      || !matchesBundledContract(saved.payload, schema) || draftBytes(saved) > maxDraftBytes) return undefined;
    const restored = record(restoreTerraformScope(saved), saved.id, Date.parse(saved.createdAt));
    return sameCheckpoint(saved, restored) ? restored : undefined;
  } catch {
    return undefined;
  }
}

export function listTerraformCheckpoints(db: IDBDatabase) {
  return listGuidedCheckpoints(db, readCheckpoint);
}

export function saveTerraformCheckpoint(db: IDBDatabase, scope: Scope, previous?: TerraformCheckpoint) {
  const now = Date.now();
  return saveGuidedCheckpoint(db, record(scope, previous?.id ?? crypto.randomUUID(), now), previous, now);
}

export function exportTerraformScope(scope: Scope) {
  const draft = record(scope, crypto.randomUUID(), Date.now());
  if (draftBytes(draft) > maxDraftBytes) throw new Error('This scope exceeds the draft size limit.');
  return JSON.stringify(draft);
}
