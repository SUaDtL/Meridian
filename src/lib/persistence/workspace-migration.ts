import { canonicalDigest } from '../authoring/base-token';
import { decodeJson } from '../authoring/decode-json';
import { inspectLegacyProject, type MigrationOutcome } from '../authoring/migrate-legacy-project';
import { decodeLegacyWorkspace, LEGACY_STORAGE_KEY, MAX_LEGACY_WORKSPACE_CODE_UNITS, MAX_PROJECTS, STORAGE_KEY, validateDocument } from '../storage';
import { captureProjectWrite } from './workspace-db';
import { elementUuidPattern } from '../authoring/identities';

const migrationKey = 'legacy-workspace';
const workspaceKey = 'active-workspace';

interface LegacySnapshot {
  key: string;
  raw: string;
}

interface QuarantinedProject {
  index: number;
  legacyId: string | null;
  reason: 'format' | Extract<MigrationOutcome, { status: 'recovery' }>['reason'];
}

export interface MigrationManifest {
  key: typeof migrationKey;
  schema: 'meridian-workspace-migration/v1';
  completedAt: string;
  sourceKey: string;
  sourceChecksum: string;
  documents: { legacyId: string; projectId: string }[];
  quarantined: QuarantinedProject[];
  counts: { total: number; migrated: number; quarantined: number };
  activeId: string | null;
}

interface MigrationRecord extends MigrationManifest {
  legacyRaw: string;
}

export type WorkspaceMigrationResult =
  | { status: 'empty' }
  | { status: 'migrated' | 'already-migrated' | 'legacy-changed'; manifest: MigrationManifest };

type LegacyStorage = Pick<Storage, 'getItem'>;
type ProjectWrite = Awaited<ReturnType<typeof captureProjectWrite>>;

function readLegacy(storage: LegacyStorage): LegacySnapshot | null {
  const current = storage.getItem(STORAGE_KEY);
  if (current !== null) return { key: STORAGE_KEY, raw: current };
  const older = storage.getItem(LEGACY_STORAGE_KEY);
  return older === null ? null : { key: LEGACY_STORAGE_KEY, raw: older };
}

function withoutRaw(record: MigrationRecord): MigrationManifest {
  const { legacyRaw: _legacyRaw, ...manifest } = record;
  return manifest;
}

function existingResult(record: MigrationRecord, sourceKey?: string, checksum?: string): WorkspaceMigrationResult {
  const changed = sourceKey !== undefined
    && (record.sourceKey !== sourceKey || record.sourceChecksum !== checksum);
  return { status: changed ? 'legacy-changed' : 'already-migrated', manifest: withoutRaw(record) };
}

function completedRecord(record: MigrationRecord | undefined, active: unknown): MigrationRecord | undefined {
  const pointer = active as { schema?: unknown; sourceChecksum?: unknown; activeId?: unknown } | undefined;
  if (record === undefined && pointer?.sourceChecksum === undefined) return undefined;
  if (!record || record.key !== migrationKey || record.schema !== 'meridian-workspace-migration/v1'
      || typeof record.legacyRaw !== 'string' || record.legacyRaw.length > MAX_LEGACY_WORKSPACE_CODE_UNITS
      || !/^[a-f0-9]{64}$/.test(record.sourceChecksum) || pointer?.schema !== 'meridian-workspace/v3'
      || pointer.sourceChecksum !== record.sourceChecksum
      || pointer.activeId !== record.activeId
      || (record.sourceKey !== STORAGE_KEY && record.sourceKey !== LEGACY_STORAGE_KEY)
      || !Array.isArray(record.documents) || !Array.isArray(record.quarantined)
      || record.counts?.migrated !== record.documents.length
      || record.counts.quarantined !== record.quarantined.length
      || record.counts.total !== record.documents.length + record.quarantined.length
      || record.counts.total > MAX_PROJECTS
      || record.documents.some(item => !item || typeof item.legacyId !== 'string'
        || typeof item.projectId !== 'string' || !elementUuidPattern.test(item.projectId))
      || (record.activeId !== null && !record.documents.some(item => item.projectId === record.activeId))
      || record.quarantined.some(item => !item || !Number.isSafeInteger(item.index)
        || item.index < 0 || item.index >= record.counts.total
        || !['format', 'source', 'size', 'annotations', 'metadata', 'identity'].includes(item.reason))) {
    throw new Error('Workspace migration information is incomplete. The original workspace is intact.');
  }
  return record;
}

export function readWorkspaceMigration(db: IDBDatabase): Promise<MigrationRecord | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['migrations', 'metadata']);
    const request = tx.objectStore('migrations').get(migrationKey);
    const active = tx.objectStore('metadata').get(workspaceKey);
    tx.oncomplete = () => {
      try {
        resolve(completedRecord(request.result, active.result));
      } catch (error) {
        reject(error);
      }
    };
    tx.onabort = () => reject(tx.error ?? new Error('Could not read the Meridian recovery snapshot.'));
  });
}

export async function reviewWorkspaceMigration(db: IDBDatabase, storage?: LegacyStorage) {
  const record = await readWorkspaceMigration(db);
  if (!record) return null;
  let original;
  try {
    original = readLegacy(storage ?? localStorage);
  } catch {
    return { manifest: withoutRaw(record), changed: null };
  }
  const changed = original !== null && (original.key !== record.sourceKey
    || original.raw.length > MAX_LEGACY_WORKSPACE_CODE_UNITS
    || await canonicalDigest('meridian-legacy-workspace/v1', original.raw) !== record.sourceChecksum);
  return { manifest: withoutRaw(record), changed };
}

export async function readMigrationBackup(db: IDBDatabase): Promise<string> {
  const record = await readWorkspaceMigration(db);
  if (!record) throw new Error('There is no saved migration backup.');
  if (await canonicalDigest('meridian-legacy-workspace/v1', record.legacyRaw) !== record.sourceChecksum) {
    throw new Error('The saved migration backup failed its integrity check.');
  }
  return record.legacyRaw;
}

function commitMigration(
  db: IDBDatabase, storage: LegacyStorage, original: LegacySnapshot,
  record: MigrationRecord, projects: readonly ProjectWrite[], signal?: AbortSignal,
): Promise<WorkspaceMigrationResult> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['documents', 'migrations', 'metadata'], 'readwrite');
    const documentsStore = tx.objectStore('documents');
    const migrations = tx.objectStore('migrations');
    const metadata = tx.objectStore('metadata');
    let failure: unknown;
    let result: WorkspaceMigrationResult = { status: 'migrated', manifest: withoutRaw(record) };
    const abort = () => {
      failure = signal?.reason;
      try {
        tx.abort();
      } catch (error) {
        // A commit that finished just before the signal cannot be undone.
        if (!(error instanceof DOMException) || error.name !== 'InvalidStateError') throw error;
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    tx.oncomplete = () => {
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    tx.onabort = () => {
      signal?.removeEventListener('abort', abort);
      reject(failure ?? tx.error ?? new Error('Workspace migration did not commit. The original workspace is intact.'));
    };

    const existing = migrations.get(migrationKey);
    const active = metadata.get(workspaceKey);
    const count = documentsStore.count();
    count.onsuccess = () => {
      try {
        const previous = completedRecord(existing.result, active.result);
        if (previous) {
          result = existingResult(previous, record.sourceKey, record.sourceChecksum);
          return;
        }
        if (active.result !== undefined) throw new Error('Meridian already has a workspace in IndexedDB.');
        if (count.result + projects.length > MAX_PROJECTS) {
          throw new Error(`The migration would exceed the ${MAX_PROJECTS}-project workspace limit.`);
        }
        const latest = readLegacy(storage);
        if (latest?.key !== original.key || latest.raw !== original.raw) {
          throw new Error('The original workspace changed while migration was prepared. Start again from the latest version.');
        }
        for (const project of projects) documentsStore.add(project);
        migrations.add(record);
        metadata.add({ key: workspaceKey, schema: 'meridian-workspace/v3',
          sourceChecksum: record.sourceChecksum, activeId: record.activeId });
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
  });
}

/** Prepare a byte-preserving migration and commit it without changing either legacy key. */
export async function migrateWorkspace(
  db: IDBDatabase, storage: LegacyStorage = localStorage, signal?: AbortSignal,
): Promise<WorkspaceMigrationResult> {
  signal?.throwIfAborted();
  const original = readLegacy(storage);
  const previous = await readWorkspaceMigration(db);
  signal?.throwIfAborted();
  if (!original) return previous ? existingResult(previous) : { status: 'empty' };
  if (original.raw.length > MAX_LEGACY_WORKSPACE_CODE_UNITS) throw new Error('The original workspace is too large to prepare.');
  const checksum = await canonicalDigest('meridian-legacy-workspace/v1', original.raw);
  signal?.throwIfAborted();
  if (previous) return existingResult(previous, original.key, checksum);

  const legacy = decodeLegacyWorkspace(original.raw, decodeJson);
  const record: MigrationRecord = {
    key: migrationKey, schema: 'meridian-workspace-migration/v1',
    completedAt: '', sourceKey: original.key, sourceChecksum: checksum, legacyRaw: original.raw,
    documents: [], quarantined: [], counts: { total: legacy.documents.length, migrated: 0, quarantined: 0 }, activeId: null,
  };
  const projects: ProjectWrite[] = [];
  const seenLegacyIds = new Set<string>();
  const seenProjectIds = new Set<string>();

  for (const [index, candidate] of legacy.documents.entries()) {
    signal?.throwIfAborted();
    let parsed;
    try {
      parsed = validateDocument(candidate);
    } catch {
      record.quarantined.push({ index, legacyId: null, reason: 'format' });
      continue;
    }
    if (seenLegacyIds.has(parsed.id)) {
      throw new Error('The original workspace has duplicate project IDs. Download it before resolving the duplicates.');
    }
    seenLegacyIds.add(parsed.id);
    const result = await inspectLegacyProject(parsed, signal);
    if (result.status === 'recovery') {
      record.quarantined.push({ index, legacyId: parsed.id, reason: result.reason });
      continue;
    }
    const project = await captureProjectWrite(result.document);
    if (seenProjectIds.has(project.id)) throw new Error('Migrated project IDs are not unique.');
    seenProjectIds.add(project.id);
    projects.push(project);
    record.documents.push({ legacyId: parsed.id, projectId: project.id });
    if (legacy.activeId === parsed.id) record.activeId = project.id;
  }
  record.activeId ??= projects[0]?.id ?? null;
  record.counts.migrated = record.documents.length;
  record.counts.quarantined = record.quarantined.length;
  record.completedAt = new Date().toISOString();
  return commitMigration(db, storage, original, record, projects, signal);
}
