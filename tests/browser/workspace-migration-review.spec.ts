import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

const source = '\uFEFFflowchart LR\r\n  A[Original]\r\n';

async function seedWorkspace(page: Page) {
  const original = { ...createDocument(), title: 'Migration example', source };
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
