import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

test('maps a local relationship table and exports distinct identities for duplicate system labels', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Systems and relationships' }).click();
  const dialog = page.getByRole('dialog', { name: 'Systems and relationships' });
  await dialog.getByLabel('Project title').fill('Mapped systems');
  await dialog.getByLabel('Choose a CSV or TSV file').setInputFiles({
    name: 'systems.tsv', mimeType: 'text/tab-separated-values',
    buffer: Buffer.from('id\tlabel\trole\tfrom\tto\tcomment\na\tService\tservice\t\t\tsession-only-cell\nb\t"Service"\tdatabase\tb\ta\t'),
  });
  await expect(dialog.getByLabel('Delimiter')).toHaveValue('\t');
  await dialog.getByRole('button', { name: 'Read table' }).click();
  await expect(dialog.getByRole('table', { name: 'First five data rows' })).toBeVisible();
  await dialog.getByLabel('System label').selectOption('1');
  await dialog.getByLabel('System ID').selectOption('0');
  await dialog.getByRole('combobox', { name: 'Role', exact: true }).selectOption('2');
  await dialog.getByLabel('Relationship source').selectOption('3');
  await dialog.getByLabel('Relationship target').selectOption('4');
  await dialog.getByRole('button', { name: 'Back to table input' }).click();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Systems and relationships' }).click();
  await expect(dialog.getByLabel('Relationship source')).toHaveValue('3');
  await dialog.getByRole('button', { name: 'Preview relationships' }).click();
  await expect(dialog.getByRole('list', { name: 'Reviewed relationships' })).toContainText('Service (row 3) → Service (row 2)');
  await expect(dialog.getByText(/Draft saved locally · expires/)).toBeVisible();
  const stored = await page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const open = indexedDB.open('meridian-workspace');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('drafts').objectStore('drafts').getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result); };
    };
  }));
  expect(stored).toHaveLength(1);
  expect(JSON.stringify(stored)).not.toContain('session-only-cell');
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Systems and relationships' }).click();
  const resume = dialog.getByRole('button', { name: /Resume Mapped systems/ });
  await expect(resume).toContainText(/Saved .* expires /);
  await resume.click();
  await expect(dialog.getByText('Relationship source uses column 4')).toBeVisible();
  await dialog.getByRole('button', { name: 'Preview relationships' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed systems diagram' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Create systems diagram' }).click();
  const project = page.getByRole('dialog', { name: 'Mapped systems' });
  await expect(project.getByText('Saved in this browser.')).toBeVisible();
  const pendingDownload = page.waitForEvent('download');
  await project.getByRole('button', { name: 'Download v3 project' }).click();
  const downloaded = await (await pendingDownload).path();
  if (!downloaded) throw new Error('No downloaded project.');
  const result = JSON.parse(await readFile(downloaded, 'utf8'));
  expect(result.source).toBe('flowchart LR\n  m_n1["Service"]\n  m_n2["Service"]\n  m_n2 m_e1@--> m_n1\n');
  const identities = result.identity.elements.filter((record: { elementKind: string }) => record.elementKind === 'node');
  expect(identities).toHaveLength(2);
  expect(identities[0].id).not.toEqual(identities[1].id);
  expect(result.roles).toEqual([{ elementId: identities[0].id, role: 'service' }, { elementId: identities[1].id, role: 'database' }]);
});

test('recovers from malformed CSV and maps corrected input in the standalone app offline', async ({ page, context }) => {
  const network: string[] = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await context.setOffline(true);
  await page.goto(pathToFileURL(resolve('standalone/Meridian.html')).href);
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Systems and relationships' }).click();
  const dialog = page.getByRole('dialog', { name: 'Systems and relationships' });
  const input = dialog.getByLabel('Paste a relationship table');
  const original = 'id,label\na,"Unclosed';
  await input.fill(original);
  await dialog.getByRole('button', { name: 'Read table' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Line 2, field 2: Close the quoted field');
  await expect(input).toHaveValue(original);
  await input.fill('id,label\na,"Client, mobile"\nb,Service');
  await dialog.getByRole('button', { name: 'Read table' }).click();
  await dialog.getByRole('combobox', { name: 'System label' }).selectOption('1');
  await dialog.getByRole('button', { name: 'Preview relationships' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed systems diagram' })).toBeVisible();
  expect(network).toEqual([]);
});
