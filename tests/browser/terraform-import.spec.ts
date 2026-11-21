import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { expectWorkspaceOmits } from './helpers';

test('resumes a reviewed Terraform scope with declared references and address-only provenance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  await page.getByRole('button', { name: 'Import Terraform JSON' }).click();
  const dialog = page.getByRole('dialog', { name: 'Terraform inventory' });
  await dialog.getByLabel('Terraform JSON file').setInputFiles({
    name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      format_version: '1.2',
      planned_values: { root_module: { resources: [
        { address: 'aws_a.app', values: { password: 'private-test-password' } },
        { address: 'aws_b.data[0]' },
        { address: 'aws_b.data["private-test-instance-key"]' },
      ] }, outputs: { secret: { value: 'private-test-output' } } },
      configuration: { root_module: { resources: [
        { address: 'aws_a.app', expressions: { database: { references: ['aws_b.data[0].id'] }, secret: { constant_value: 'private-test-constant' } } },
        { address: 'aws_b.data' },
      ] } },
    })),
  });
  await dialog.getByRole('button', { name: 'Read Terraform facts' }).click();
  await dialog.getByRole('checkbox', { name: 'aws_a.app', exact: true }).check();
  await expect(dialog.getByText(/1 inventory address without an exact configuration address/)).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'aws_b.data[0]', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Show declared references between selected resources' }).check();
  await expect(dialog.getByRole('status')).toHaveText('2 selected resources · 0 outside visible rows · 1 selected reference');
  await dialog.getByRole('button', { name: 'Save scope draft' }).click();
  await expect(dialog.getByText('Inventory facts and scope saved in this browser.')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Find resources' }).fill('aws_a');
  await expect(dialog.getByText('2 selected resources · 1 outside visible rows · 1 selected reference')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  await page.getByRole('button', { name: 'Import Terraform JSON' }).click();
  await dialog.getByRole('button', { name: /Resume plan.json/ }).click();
  await expect(dialog.getByRole('heading', { name: 'Choose inventory scope' })).toBeFocused();
  await expect(dialog.getByText('Inventory scope restored. Preview the scope before creating a project.')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'aws_b.data[0]', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Show declared references between selected resources' })).toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Create inventory project' })).toHaveCount(0);
  const readDrafts = () => page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const open = indexedDB.open('meridian-workspace');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts');
      const request = tx.objectStore('drafts').getAll();
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }));
  const drafts = await readDrafts();
  await expectWorkspaceOmits(page, ['private-test-']);
  expect(drafts).toEqual([expect.objectContaining({ feature: 'engineering-facts', payload: expect.objectContaining({
    adapter: 'terraform-show', virtualPaths: ['plan.json'], selectedFactIds: ['f1', 'f2'], selectedRelationshipIds: ['r1'],
  }) })]);
  expect(JSON.stringify(drafts)).not.toMatch(/private-test-|constant_value|password|outputs/);
  const [draft] = await Promise.all([
    page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download scope draft' }).click(),
  ]);
  const draftPath = await draft.path();
  if (!draftPath) throw new Error('Missing scope download.');
  const draftText = await readFile(draftPath, 'utf8');
  expect(draftText).not.toMatch(/private-test-|constant_value|password|outputs/);
  expect(JSON.parse(draftText).payload).toEqual((drafts[0] as { payload: unknown }).payload);
  await page.evaluate(saved => new Promise<void>((resolve, reject) => {
    const open = indexedDB.open('meridian-workspace');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts', 'readwrite');
      tx.objectStore('drafts').put({ ...saved as object, id: 'fc2ed6ec-6fdc-4e8c-935f-7f9ba5546493',
        createdAt: '2024-01-01T00:00:00.000Z', expiresAt: '2024-01-08T00:00:00.000Z' });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), drafts[0]);
  await dialog.getByRole('button', { name: 'Save scope draft' }).click();
  await expect(dialog.getByText('Inventory facts and scope saved in this browser.')).toBeVisible();
  expect(await readDrafts()).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Preview inventory' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed Terraform inventory' })).toBeVisible();
  await expect(dialog.getByText(/numeric instance indexes with full-width brackets/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Create inventory project' }).click();
  const live = page.getByRole('dialog', { name: 'Terraform planned resource inventory' });
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing project download.');
  const body = await readFile(path, 'utf8');
  const project = JSON.parse(body);
  expect(project.source).toContain('Declared reference');
  expect(project.source).toContain('aws_b.data［0］');
  expect(project.provenance).toContainEqual(expect.objectContaining({
    virtualPath: 'plan.json', pointer: '/configuration/root_module/resources/0/expressions/database/references/0',
    relationship: 'Declared Terraform configuration reference',
  }));
  expect(body).not.toContain('private-test-');
  await expectWorkspaceOmits(page, ['private-test-']);
  expect(await readDrafts()).toEqual([]);
});
