import { proveFlowchartEdit, type SourceIntent } from '../../src/lib/authoring/flowchart-proof';
import { createDocument } from '../../src/lib/storage';

async function prove(source: string, intent: SourceIntent) {
  const document = { ...createDocument(), source };
  const result = await proveFlowchartEdit(document, intent);
  return { source: result.source, sourceId: result.sourceId, original: document.source };
}

declare global {
  interface Window {
    proveFlowchartFixture: typeof prove;
  }
}

window.proveFlowchartFixture = prove;

type LegacyFixtureProject = ReturnType<typeof createDocument>;

declare global {
  interface Window {
    migrateLegacyFixture: (document: LegacyFixtureProject) => ReturnType<typeof import('../../src/lib/authoring/migrate-legacy-project').inspectLegacyProject>;
  }
}

window.migrateLegacyFixture = async document => {
  const { inspectLegacyProject } = await import('../../src/lib/authoring/migrate-legacy-project');
  return inspectLegacyProject(document);
};

declare global {
  interface Window {
    checkConcurrentWorkspaceSave: (document: LegacyFixtureProject) => Promise<{ winners: number; rejected: string[]; savedTitle: string; staleSameDigest: string }>;
  }
}

window.checkConcurrentWorkspaceSave = async legacy => {
  const result = await window.migrateLegacyFixture(legacy);
  if (result.status !== 'migrated') throw new Error(result.reason);
  const { openWorkspaceDatabase, readWorkspaceProject, writeWorkspaceProject } = await import('../../src/lib/persistence/workspace-db');
  const first = await openWorkspaceDatabase();
  const second = await openWorkspaceDatabase();
  try {
    const original = result.document;
    const saved = await writeWorkspaceProject(first, original, null);
    const outcomes = await Promise.allSettled([
      writeWorkspaceProject(first, { ...original, title: 'First tab', revision: 1 }, saved),
      writeWorkspaceProject(second, { ...original, title: 'Second tab', revision: 1 }, saved),
    ]);
    const stored = await readWorkspaceProject(first, original.id);
    if (!stored) throw new Error('Missing committed project.');
    const actual = stored.document;
    const rejected = outcomes.flatMap(outcome => outcome.status === 'rejected' ? [outcome.reason.name] : []);
    const previousAnchor = outcomes.find(outcome => outcome.status === 'fulfilled');
    if (!previousAnchor) throw new Error('Neither write committed.');
    const checkpoint = await writeWorkspaceProject(first, actual, previousAnchor.value);
    if (checkpoint.stateDigest !== previousAnchor.value.stateDigest || checkpoint.storageGeneration === previousAnchor.value.storageGeneration) {
      throw new Error('An unchanged checkpoint must keep its authored digest and get a fresh generation.');
    }
    let staleSameDigest = '';
    try {
      await writeWorkspaceProject(second, { ...actual, title: 'A stale write' }, previousAnchor.value);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      staleSameDigest = error.name;
    }
    return { winners: outcomes.length - rejected.length, rejected, savedTitle: actual.title, staleSameDigest };
  } finally {
    first.close();
    second.close();
  }
};

async function checkInterruptedMigration() {
  const { LEGACY_STORAGE_KEY, STORAGE_KEY } = await import('../../src/lib/storage');
  const { openWorkspaceDatabase } = await import('../../src/lib/persistence/workspace-db');
  const { migrateWorkspace, readWorkspaceMigration } = await import('../../src/lib/persistence/workspace-migration');
  const first = { ...createDocument(), title: 'First', source: '\uFEFFflowchart LR\r\nA[One]\r\n' };
  const second = { ...createDocument(), title: 'Second', source: 'flowchart LR\nB[Two]' };
  const invalid = { ...createDocument(), title: 'Needs recovery', source: 'flowchart LR\nC[' };
  const raw = JSON.stringify({ version: 2, documents: [first, second, invalid], activeId: second.id }, null, 2);
  localStorage.setItem(STORAGE_KEY, raw);
  const v1 = JSON.stringify({ version: 1, documents: [first], activeId: first.id });
  localStorage.setItem(LEGACY_STORAGE_KEY, v1);

  const db = await openWorkspaceDatabase();
  const count = () => new Promise<number>((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const readActive = () => new Promise<unknown>((resolve, reject) => {
    const request = db.transaction('metadata').objectStore('metadata').get('active-workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const interrupted: { reached: number; projects: number; hasArchive: boolean; hasActive: boolean }[] = [];
  const add = IDBObjectStore.prototype.add;
  try {
    // Abort after each actual browser write request succeeds. None of those
    // individual request successes may be mistaken for a migration commit.
    for (let boundary = 1; boundary <= 4; boundary++) {
      const controller = new AbortController();
      let writes = 0;
      let reached = 0;
      IDBObjectStore.prototype.add = function (...args: Parameters<typeof add>) {
        const request = add.apply(this, args);
        if (++writes === boundary) request.addEventListener('success', () => {
          reached = boundary;
          controller.abort();
        });
        return request;
      };
      try {
        await migrateWorkspace(db, localStorage, controller.signal);
        throw new Error('The interrupted migration unexpectedly committed.');
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
      } finally {
        IDBObjectStore.prototype.add = add;
      }
      interrupted.push({ reached, projects: await count(), hasArchive: Boolean(await readWorkspaceMigration(db)),
        hasActive: Boolean(await readActive()) });
    }

    let reads = 0;
    const changedBeforeCommit = await migrateWorkspace(db, {
      getItem(key) {
        if (key === STORAGE_KEY) return ++reads === 1 ? raw : raw + '\n';
        return localStorage.getItem(key);
      },
    }).then(() => false, error => error instanceof Error && error.message.includes('changed while migration'));
    if (await count() !== 0 || await readActive() || await readWorkspaceMigration(db)) {
      throw new Error('Changed source left partial storage.');
    }

    const peer = await openWorkspaceDatabase();
    let outcomes;
    try {
      // Preflight parses use the same renderer. An equivalent sequential
      // retry covers the persisted receipt while avoiding parallel Mermaid work.
      outcomes = [await migrateWorkspace(db), await migrateWorkspace(peer)];
    } finally {
      peer.close();
    }
    if (outcomes[0].status !== 'migrated') throw new Error('Migration did not commit.');
    const archive = await readWorkspaceMigration(db);
    const metadata = await readActive();
    const bothLegacyKeysPreserved = localStorage.getItem(STORAGE_KEY) === raw && localStorage.getItem(LEGACY_STORAGE_KEY) === v1;
    localStorage.setItem(STORAGE_KEY, raw + '\n');
    const changedLater = await migrateWorkspace(db);
    return {
      interrupted, changedBeforeCommit, migratedCount: await count(),
      statuses: outcomes.map(outcome => outcome.status),
      activation: metadata, manifest: outcomes[0].manifest,
      backedUpExactly: archive?.legacyRaw === raw, bothLegacyKeysPreserved,
      changedLater: changedLater.status, secondId: second.id,
    };
  } finally {
    IDBObjectStore.prototype.add = add;
    db.close();
  }
}

declare global {
  interface Window {
    checkInterruptedMigration: typeof checkInterruptedMigration;
  }
}
window.checkInterruptedMigration = checkInterruptedMigration;
