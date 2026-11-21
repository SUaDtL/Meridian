import { expect, test, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

const stores = ['documents', 'migrations', 'metadata'] as const;

async function openMigration(page: Page) {
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  return page.getByRole('dialog', { name: 'Project migration and recovery' });
}

function readMigrationStores(page: Page) {
  return page.evaluate(names => new Promise<unknown[][]>((resolve, reject) => {
    const open = indexedDB.open('meridian-workspace');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction(names);
      const requests = names.map(name => transaction.objectStore(name).getAll());
      transaction.oncomplete = () => { db.close(); resolve(requests.map(request => request.result)); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), [...stores]);
}

const boundaries = [
  { store: 'documents', ordinal: 1, title: 'first document' },
  { store: 'documents', ordinal: 2, title: 'second document' },
  { store: 'migrations', ordinal: 1, title: 'migration record' },
  { store: 'metadata', ordinal: 1, title: 'active workspace pointer' },
] as const;

for (const boundary of boundaries) {
  test(`rolls back every migration record after interruption at the ${boundary.title} write`, async ({ page }) => {
    const first = { ...createDocument(), title: 'Endpoint diagram', source: '\uFEFFflowchart LR\r\n  A[Endpoint]\r\n' };
    const second = { ...createDocument(), title: 'Queue diagram', source: 'flowchart LR\n  B[Queue]\n' };
    const raw = JSON.stringify({ version: 2, activeId: first.id, documents: [first, second] }, null, 4);
    await page.addInitScript(({ key, raw, boundary }) => {
      if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
      const add = IDBObjectStore.prototype.add;
      let writes = 0;
      IDBObjectStore.prototype.add = function (...args) {
        const request = add.apply(this, args);
        if (this.name === boundary.store && !sessionStorage.getItem('migration-interrupted') && ++writes === boundary.ordinal) {
          const transaction = this.transaction;
          request.addEventListener('success', () => {
            sessionStorage.setItem('migration-interrupted', boundary.title);
            transaction.abort();
          }, { once: true });
        }
        return request;
      };
    }, { key: STORAGE_KEY, raw, boundary });

    await page.goto('/');
    const migration = await openMigration(page);
    await migration.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await expect(migration.getByRole('alert')).toHaveText('Workspace migration did not commit. The original workspace is intact.');
    expect(await page.evaluate(() => sessionStorage.getItem('migration-interrupted'))).toBe(boundary.title);
    expect(await readMigrationStores(page)).toEqual([[], [], []]);
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);

    await page.reload();
    const reopened = await openMigration(page);
    await expect(reopened.getByRole('button', { name: 'Download pre-migration backup' })).toHaveCount(0);
    await reopened.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await expect(reopened.getByText('2 copied · 0 need recovery')).toBeVisible();
    const [documents, migrations, metadata] = await readMigrationStores(page);
    expect(documents).toHaveLength(2);
    expect(documents).toEqual(expect.arrayContaining([first, second].map(legacy => expect.objectContaining({
      id: legacy.id, document: expect.objectContaining({ id: legacy.id, schema: 'meridian/v3', source: legacy.source }),
      anchor: expect.objectContaining({ stateDigest: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }))));
    expect(migrations).toEqual([expect.objectContaining({
      key: 'legacy-workspace', sourceChecksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      activeId: first.id, legacyRaw: raw, counts: { total: 2, migrated: 2, quarantined: 0 },
    })]);
    expect(metadata).toEqual([expect.objectContaining({
      key: 'active-workspace', schema: 'meridian-workspace/v3', activeId: first.id,
      sourceChecksum: (migrations[0] as { sourceChecksum: string }).sourceChecksum,
    })]);
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
  });
}
