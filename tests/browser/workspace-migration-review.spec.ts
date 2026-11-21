import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { projectBaseToken } from '../../src/lib/authoring/base-token';

const source = '\uFEFFflowchart LR\r\n  A[Original]\r\n';

async function seedWorkspace(page: Page, originalSource = source) {
  const original = { ...createDocument(), title: 'Migration example', source: originalSource };
  const invalid = { ...createDocument(), title: 'Unfinished diagram', source: 'flowchart LR\n  A[' };
  const raw = JSON.stringify({ version: 2, activeId: original.id, documents: [original, invalid] }, null, 4);
  await page.addInitScript(({ key, raw }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, raw);
  }, { key: STORAGE_KEY, raw });
  await page.goto('/');
  return { original, raw };
}

async function openReview(page: Page) {
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  return page.getByRole('dialog', { name: 'Project migration and recovery' });
}

async function download(page: Page, label: string) {
  const [file] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: label, exact: true }).click(),
  ]);
  const path = await file.path();
  if (!path) throw new Error('No download path.');
  return readFile(path, 'utf8');
}

test('reviews migration, downloads the exact originals and notices edits from an older workspace', async ({ page, context }) => {
  const { original, raw } = await seedWorkspace(page);
  const dialog = await openReview(page);
  await dialog.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await expect(dialog.getByText('1 copied · 1 need recovery')).toBeVisible();
  await expect(dialog.getByText('Project 2 in the backup. The diagram could not be verified.')).toBeVisible();
  expect(await download(page, 'Download pre-migration backup')).toBe(raw);
  expect(await download(page, 'Download current legacy workspace')).toBe(raw);
  const converted = JSON.parse(await download(page, 'Download v3 copy of Migration example'));
  expect(converted).toMatchObject({ schema: 'meridian/v3', id: original.id, source });

  const older = await context.newPage();
  await older.goto('/');
  const changed = raw.replace('Migration example', 'Updated by older editor');
  await older.evaluate(({ key, changed }) => localStorage.setItem(key, changed), { key: STORAGE_KEY, changed });
  await expect(dialog.getByText(/An older workspace changed/)).toBeVisible();
  expect(await download(page, 'Download current legacy workspace')).toBe(changed);
  expect(await download(page, 'Download pre-migration backup')).toBe(raw);
  expect(JSON.parse(await download(page, 'Download v3 copy of Migration example'))).toEqual(converted);

  await page.reload();
  const reopened = await openReview(page);
  await expect(reopened.getByText(/An older workspace changed/)).toBeVisible();
  await expect(reopened.getByRole('button', { name: 'Download v3 copy of Migration example' })).toBeEnabled();
});

test('keeps the legacy backup available after a quota failure and permits a clean retry', async ({ page }) => {
  await page.addInitScript(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'migrations' && !sessionStorage.getItem('retried')) {
        sessionStorage.setItem('retried', 'yes');
        throw new DOMException('Browser storage is full.', 'QuotaExceededError');
      }
      return add.apply(this, args);
    };
  });
  const { raw } = await seedWorkspace(page);
  const dialog = await openReview(page);
  await dialog.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Browser storage is full.');
  expect(await download(page, 'Download current legacy workspace')).toBe(raw);
  await expect(dialog.getByRole('button', { name: 'Download pre-migration backup' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await expect(dialog.getByText('1 copied · 1 need recovery')).toBeVisible();
  expect(await download(page, 'Download pre-migration backup')).toBe(raw);
});

test('downloads the exact legacy workspace while an older tab blocks the database upgrade', async ({ page, context }) => {
  const { raw } = await seedWorkspace(page);
  const oldProject = JSON.parse(await readFile('src/lib/authoring/fixtures/example-project.json', 'utf8'));
  const { stateDigest } = await projectBaseToken(oldProject);
  const authored = { id: oldProject.id, document: oldProject, anchor: { stateDigest, storageGeneration: crypto.randomUUID() } };
  const older = await context.newPage();
  try {
    await older.goto('/');
    await older.evaluate(authored => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('meridian-workspace', 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore('documents', { keyPath: 'id' }).add(authored);
        db.createObjectStore('datasets', { keyPath: 'digest' });
        db.createObjectStore('library', { keyPath: ['id', 'version'] });
        for (const store of ['drafts', 'pendingAssist']) db.createObjectStore(store, { keyPath: 'id' });
        for (const store of ['migrations', 'metadata', 'previews']) db.createObjectStore(store, { keyPath: 'key' });
      };
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        // An older tab which never received the modern versionchange handler
        // keeps this connection alive until its document closes.
        (window as Window & { oldMeridianConnection?: IDBDatabase }).oldMeridianConnection = open.result;
        resolve();
      };
    }), authored);

    const dialog = await openReview(page);
    await expect(dialog.getByRole('alert')).toHaveText('Close older Meridian tabs before preparing the workspace database.');
    expect(await download(page, 'Download current legacy workspace')).toBe(raw);
    expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(raw);
    await expect(dialog.getByRole('button', { name: 'Download pre-migration backup' })).toHaveCount(0);
  } finally {
    await older.close();
  }

  const current = page.getByRole('dialog', { name: 'Project migration and recovery' });
  await current.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await expect(current.getByText('1 copied · 1 need recovery')).toBeVisible();
  await expect(current.getByRole('alert')).toHaveCount(0);
  expect(await download(page, 'Download pre-migration backup')).toBe(raw);
  expect(JSON.parse(await download(page, `Download v3 copy of ${oldProject.title}`))).toEqual(oldProject);
});

test('round-trips and previews a portable v3 project before a later legacy migration', async ({ page, browser }) => {
  const { raw } = await seedWorkspace(page);
  const origin = await openReview(page);
  await origin.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await expect(origin.getByText('1 copied · 1 need recovery')).toBeVisible();
  const portable = await download(page, 'Download v3 copy of Migration example');
  const original = JSON.parse(portable);

  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin, acceptDownloads: true, viewport: { width: 390, height: 844 } });
  try {
    const destination = await fresh.newPage();
    await destination.goto('/');
    const dialog = await openReview(destination);
    await expect(dialog.getByRole('button', { name: 'Import v3 project', exact: true })).toBeEnabled();
    await dialog.getByLabel('Import v3 project file').setInputFiles({
      name: 'duplicate.meridian.json', mimeType: 'application/json',
      buffer: Buffer.from('{"schema":"meridian/v3","schema":"meridian/v3"}'),
    });
    await expect(dialog.getByRole('alert')).toHaveText('The JSON contains a repeated object key.');
    await expect(dialog.getByRole('button', { name: /Download v3 copy of/ })).toHaveCount(0);
    await dialog.getByLabel('Import v3 project file').setInputFiles({
      name: 'diagram.meridian.json', mimeType: 'application/json', buffer: Buffer.from(portable),
    });
    await expect(dialog.getByText('Imported Migration example as a separate v3 project.')).toBeVisible();
    const saved = JSON.parse(await download(destination, 'Download v3 copy of Migration example'));
    expect(saved.id).not.toBe(original.id);
    expect(saved).toEqual({ ...original, id: saved.id, revision: 0 });
    await dialog.getByRole('button', { name: 'Open v3 project Migration example' }).click();
    const preview = destination.getByRole('dialog', { name: 'Migration example', exact: true });
    await expect.poll(() => preview.getByRole('img', { name: 'Diagram preview for Migration example' })
      .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await preview.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
    await preview.getByText('Mermaid source', { exact: true }).click();
    expect(await preview.locator('pre').textContent()).toBe(source);
    expect(await download(destination, 'Download HTML presentation')).toContain('Migration example');
    await preview.getByRole('button', { name: 'Back to v3 projects' }).click();

    await destination.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
      key: STORAGE_KEY, raw: raw.replace('Migration example', 'Later legacy project'),
    });
    await destination.reload();
    const reopened = await openReview(destination);
    await expect(reopened.getByRole('button', { name: 'Download v3 copy of Migration example' })).toBeEnabled();
    await reopened.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await expect(reopened.getByText('1 copied · 1 need recovery')).toBeVisible();
    await expect(reopened.getByRole('button', { name: 'Download v3 copy of Later legacy project' })).toBeEnabled();
    expect(JSON.parse(await download(destination, 'Download v3 copy of Migration example'))).toEqual(saved);
  } finally {
    await fresh.close();
  }
});

async function changeHeading(page: Page, title: string) {
  await page.getByRole('button', { name: 'Edit heading', exact: true }).click();
  const heading = page.getByRole('dialog', { name: 'Edit heading', exact: true });
  await heading.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await heading.getByRole('button', { name: 'Apply heading', exact: true }).click();
  await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
}

test('opens a live v3 project, saves reversible edits and recovers a second tab as a separate project', async ({ page, context }) => {
  const { original, raw } = await seedWorkspace(page);
  const list = await openReview(page);
  await list.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await list.getByRole('button', { name: 'Open v3 project Migration example' }).click();
  const second = await context.newPage();
  await second.goto('/');
  const secondList = await openReview(second);
  await secondList.getByRole('button', { name: 'Open v3 project Migration example' }).click();
  await expect(second.getByText('Saved in this browser.', { exact: true })).toBeVisible();

  await changeHeading(page, 'First tab edit');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Migration example', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'First tab edit', exact: true })).toBeVisible();
  await expect(page.getByText('Saved in this browser.', { exact: true })).toBeVisible();
  const first = JSON.parse(await download(page, 'Download v3 project'));
  expect(first).toMatchObject({ id: original.id, title: 'First tab edit', revision: 3, source });

  await changeHeading(second, 'Second tab edit');
  await expect(second.getByText('Changes are only in this session.')).toBeVisible();
  await second.getByRole('button', { name: 'Back to v3 projects' }).click();
  await expect(second.getByText(/Your latest changes are still in this session/)).toBeVisible();
  await second.getByRole('button', { name: 'Reload saved version' }).click();
  await second.getByRole('button', { name: 'Cancel reload' }).click();
  const unsaved = JSON.parse(await download(second, 'Download my changes'));
  expect(unsaved).toMatchObject({ id: original.id, title: 'Second tab edit', source });
  await second.getByRole('button', { name: 'Save my changes as a new project' }).click();
  await expect(secondList.getByRole('button', { name: 'Download v3 copy of Second tab edit' })).toBeEnabled();
  const savedCopy = JSON.parse(await download(second, 'Download v3 copy of Second tab edit'));
  expect(savedCopy.id).not.toBe(first.id);
  expect(savedCopy).toEqual({ ...unsaved, id: savedCopy.id, revision: 0 });
  expect(JSON.parse(await download(second, 'Download v3 copy of First tab edit'))).toEqual(first);
  expect(await download(second, 'Download pre-migration backup')).toBe(raw);
});

test('resolves a label draft before switching to a different operation or target', async ({ page }) => {
  const authored = source + '  B[Archive]\r\n';
  await seedWorkspace(page, authored);
  const list = await openReview(page);
  await list.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await list.getByRole('button', { name: 'Open v3 project Migration example' }).click();
  const original = JSON.parse(await download(page, 'Download v3 project'));
  await page.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  const operations = edit.getByRole('combobox', { name: 'Operation' });
  const nodes = edit.getByRole('combobox', { name: 'Node to rename' });
  const label = edit.getByRole('textbox', { name: 'Node label' });
  const pending = edit.getByRole('region', { name: 'Unsaved label edit' });
  await operations.selectOption('setNodeLabel');
  await nodes.selectOption({ label: 'Original (A)' });
  await expect(label).toHaveValue('Original');
  await label.fill('Discarded wording');
  await nodes.selectOption({ label: 'Archive (B)' });
  await expect(pending).toContainText('choosing another element');
  await expect(pending.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await expect(label).toHaveValue('Discarded wording');
  await pending.getByRole('button', { name: 'Discard label and continue' }).press('Enter');
  await expect(nodes).toBeFocused();
  await expect(label).toHaveValue('Archive');

  await label.fill('A|B');
  await operations.selectOption('addEdge');
  await expect(pending).toContainText('changing operations');
  await pending.getByRole('button', { name: 'Review label before saving' }).press('Enter');
  await expect(edit.getByRole('alert')).toContainText('could not display that label exactly');
  await expect(label).toHaveValue('A|B');
  await expect(label).toBeFocused();
  await label.fill('Accepted archive');
  await pending.getByRole('button', { name: 'Review label before saving' }).press('Enter');
  const save = edit.getByRole('button', { name: 'Save label and continue' });
  await expect(save).toBeFocused();
  await save.press('Enter');
  await expect(operations).toHaveValue('addEdge');
  await expect(operations).toBeFocused();
  await expect(edit.getByRole('combobox', { name: 'To', exact: true }).getByRole('option', { name: 'Accepted archive (B)' })).toHaveCount(1);
  await edit.getByRole('button', { name: 'Cancel', exact: true }).click();
  const accepted = JSON.parse(await download(page, 'Download v3 project'));
  expect(accepted.source).toBe(authored.replace('B[Archive]', 'B["Accepted archive"]'));
  expect(accepted.revision).toBe(original.revision + 1);
  expect(accepted.identity).toEqual(original.identity);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Saved in this browser.', { exact: true })).toBeVisible();
  expect(JSON.parse(await download(page, 'Download v3 project')).source).toBe(authored);
});

test('saves or discards a renamed label before switching projects', async ({ page }) => {
  const first = { ...createDocument(), title: 'First diagram', source };
  const second = { ...createDocument(), title: 'Second diagram', source: 'flowchart LR\nB[Independent]' };
  await page.addInitScript(({ key, first, second }) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, JSON.stringify({ version: 2, activeId: first.id, documents: [first, second] }));
    }
  }, { key: STORAGE_KEY, first, second });
  await page.goto('/');
  const list = await openReview(page);
  await list.getByRole('button', { name: 'Prepare v3 copies' }).click();
  const open = (name: string) => list.getByRole('button', { name: `Open v3 project ${name}` }).click();
  await open(first.title);
  const original = JSON.parse(await download(page, 'Download v3 project'));
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  const label = edit.getByRole('textbox', { name: 'Node label' });
  const pending = edit.getByRole('region', { name: 'Unsaved label edit' });
  const switchProject = edit.getByRole('button', { name: 'Switch project' });
  async function rename() {
    await page.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
    await edit.getByRole('combobox', { name: 'Operation' }).selectOption('setNodeLabel');
    await edit.getByRole('combobox', { name: 'Node to rename' }).selectOption({ label: 'Original (A)' });
  }
  await rename();
  await label.fill('Discarded at switch');
  await switchProject.press('Enter');
  await expect(pending).toContainText('switching projects');
  const keep = pending.getByRole('button', { name: 'Keep editing' });
  await expect(keep).toBeFocused();
  await keep.press('Enter');
  await expect(label).toBeFocused();
  await expect(label).toHaveValue('Discarded at switch');
  await switchProject.press('Enter');
  await pending.getByRole('button', { name: 'Discard label and continue' }).press('Enter');
  await open(second.title);
  const independent = await download(page, 'Download v3 project');
  await page.getByRole('button', { name: 'Back to v3 projects' }).click();
  await open(first.title);
  expect(JSON.parse(await download(page, 'Download v3 project'))).toEqual(original);
  await rename();
  await label.fill('Saved at switch');
  await switchProject.press('Enter');
  await pending.getByRole('button', { name: 'Review label before saving' }).press('Enter');
  const save = edit.getByRole('button', { name: 'Save label and continue' });
  await expect(save).toBeFocused();
  await save.press('Enter');
  await open(second.title);
  expect(await download(page, 'Download v3 project')).toBe(independent);
  await page.getByRole('button', { name: 'Back to v3 projects' }).click();
  await open(first.title);
  const saved = JSON.parse(await download(page, 'Download v3 project'));
  expect(saved.source).toBe(source.replace('A[Original]', 'A["Saved at switch"]'));
  expect(saved.identity).toEqual(original.identity);
  expect(saved.revision).toBe(original.revision + 1);
});

test('previews and commits Add, Rename and Connect through the live v3 workspace', async ({ page }) => {
  await seedWorkspace(page);
  const list = await openReview(page);
  await list.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await list.getByRole('button', { name: 'Open v3 project Migration example' }).click();
  const original = JSON.parse(await download(page, 'Download v3 project'));

  async function openEdit() {
    await page.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
    return page.getByRole('dialog', { name: 'Edit flowchart', exact: true });
  }

  async function prepareAndApply(dialog: Awaited<ReturnType<typeof openEdit>>) {
    const apply = dialog.getByRole('button', { name: 'Apply change' });
    await expect(apply).toBeDisabled();
    await dialog.getByRole('button', { name: 'Preview change' }).click();
    await expect.poll(() => dialog.getByRole('img', { name: 'Proposed diagram' })
      .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await apply.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText('Saved in this browser.', { exact: true })).toBeVisible();
  }

  const cancelled = await openEdit();
  await cancelled.getByRole('textbox', { name: 'Node label' }).fill('Unsaved preview');
  await cancelled.getByRole('button', { name: 'Preview change' }).click();
  await expect(cancelled.getByRole('button', { name: 'Apply change' })).toBeEnabled();
  await cancelled.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(JSON.parse(await download(page, 'Download v3 project'))).toEqual(original);

  const add = await openEdit();
  await add.getByRole('textbox', { name: 'Node label' }).fill('Archive');
  await add.getByRole('combobox', { name: 'Shape' }).selectOption('cylinder');
  await prepareAndApply(add);
  const added = JSON.parse(await download(page, 'Download v3 project'));
  expect(added.source).toBe(source + '  m_n1[("Archive")]\r\n');

  const rename = await openEdit();
  await rename.getByRole('combobox', { name: 'Operation' }).selectOption('setNodeLabel');
  await rename.getByRole('combobox', { name: 'Node to rename' }).selectOption({ label: 'Original (A)' });
  await rename.getByRole('textbox', { name: 'Node label' }).fill('Intake');
  await prepareAndApply(rename);

  const connect = await openEdit();
  await connect.getByRole('combobox', { name: 'Operation' }).selectOption('addEdge');
  await connect.getByRole('combobox', { name: 'From', exact: true }).selectOption({ label: 'Intake (A)' });
  await connect.getByRole('combobox', { name: 'To', exact: true }).selectOption({ label: 'Archive (m_n1)' });
  await connect.getByRole('textbox', { name: 'Connection label (optional)' }).fill('Publish');
  await prepareAndApply(connect);
  const connected = JSON.parse(await download(page, 'Download v3 project'));
  expect(connected.source).toBe(added.source.replace('A[Original]', 'A["Intake"]') + '  A m_e1@-->|"Publish"| m_n1\r\n');
  expect(connected.revision).toBe(3);
  expect(connected.identity.elements).toContainEqual(original.identity.elements[0]);
  expect(connected.identity.elements).toHaveLength(3);

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByText('Saved in this browser.', { exact: true })).toBeVisible();
  const undone = JSON.parse(await download(page, 'Download v3 project'));
  expect(undone.source).toBe(added.source.replace('A[Original]', 'A["Intake"]'));
  expect(undone.revision).toBe(4);
});

test('Escape cancels delayed structural validation before blur can commit a rename', async ({ page }) => {
  await seedWorkspace(page);
  const list = await openReview(page);
  await list.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await list.getByRole('button', { name: 'Open v3 project Migration example' }).click();
  const original = await download(page, 'Download v3 project');

  await page.evaluate(() => {
    const digest = crypto.subtle.digest;
    const gate = new Promise<void>(resolve => window.addEventListener('release-rename-validation', () => resolve(), { once: true }));
    crypto.subtle.digest = async function (algorithm, data) {
      const input = new TextDecoder().decode(data);
      if (!input.startsWith('meridian-source/v1\0') || !input.includes('Delayed label')) {
        return digest.call(this, algorithm, data);
      }
      document.documentElement.dataset.renameValidation = 'held';
      await gate;
      const output = await digest.call(this, algorithm, data);
      document.documentElement.dataset.renameValidation = 'released';
      return output;
    };
  });

  await page.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit flowchart', exact: true });
  await dialog.getByRole('combobox', { name: 'Operation' }).selectOption('setNodeLabel');
  await dialog.getByRole('combobox', { name: 'Node to rename' }).selectOption({ label: 'Original (A)' });
  await dialog.getByRole('textbox', { name: 'Node label' }).fill('Delayed label');
  await dialog.getByRole('button', { name: 'Preview change' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-rename-validation', 'held');
  await expect(dialog.getByRole('button', { name: 'Apply change' })).toBeDisabled();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Download v3 project' }).focus();
  await page.evaluate(() => window.dispatchEvent(new Event('release-rename-validation')));
  await expect(page.locator('html')).toHaveAttribute('data-rename-validation', 'released');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  expect(await download(page, 'Download v3 project')).toBe(original);
  await page.reload();
  const reopened = await openReview(page);
  await reopened.getByRole('button', { name: 'Open v3 project Migration example' }).click();
  expect(await download(page, 'Download v3 project')).toBe(original);
});

test('reopens the last durable revision when a tab closes before its project write commits', async ({ page, context }) => {
  const { original } = await seedWorkspace(page);
  const migration = await openReview(page);
  await migration.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await migration.getByRole('button', { name: 'Open v3 project Migration example' }).click();
  async function editTitle(previous: string, next: string) {
    await page.getByRole('dialog', { name: previous, exact: true }).getByRole('button', { name: 'Edit heading' }).click();
    const heading = page.getByRole('dialog', { name: 'Edit heading' });
    await heading.getByRole('textbox', { name: 'Title', exact: true }).fill(next);
    await heading.getByRole('button', { name: 'Apply heading' }).click();
  }

  await editTitle('Migration example', 'Durable heading');
  const durableProject = page.getByRole('dialog', { name: 'Durable heading', exact: true });
  await expect(durableProject.getByText('Saved in this browser.')).toBeVisible();
  const durable = await download(page, 'Download v3 project');

  await page.evaluate(projectId => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const write = put.call(this, value, key);
      if (this.name === 'documents' && value?.id === projectId && value?.document?.title === 'Unfinished heading') {
        const currentStore = this;
        // Keep the real read-write transaction active after its successful put.
        // Closing this tab ends the transaction before the durable complete event.
        const keepOpen = () => {
          const read = currentStore.get(projectId);
          read.onsuccess = keepOpen;
        };
        keepOpen();
        write.onsuccess = () => { document.documentElement.dataset.heldProjectWrite = 'true'; };
      }
      return write;
    };
  }, original.id);
  await editTitle('Durable heading', 'Unfinished heading');
  await expect(page.getByRole('dialog', { name: 'Unfinished heading', exact: true }).getByText('Saving changes…')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-held-project-write', 'true');
  await page.close({ runBeforeUnload: false });

  const reopened = await context.newPage();
  await reopened.goto('/');
  const review = await openReview(reopened);
  await expect(review.getByRole('button', { name: 'Open v3 project Unfinished heading' })).toHaveCount(0);
  await review.getByRole('button', { name: 'Open v3 project Durable heading' }).click();
  await expect(reopened.getByRole('dialog', { name: 'Durable heading', exact: true }).getByText('Saved in this browser.')).toBeVisible();
  expect(await download(reopened, 'Download v3 project')).toBe(durable);
});
