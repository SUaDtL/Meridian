import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function readDrafts(page: Page) {
  return page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const open = indexedDB.open('meridian-workspace');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('drafts').objectStore('drafts').getAll();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result); };
    };
  }));
}

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
  const stored = await readDrafts(page);
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

test('inserts a mapped table after rejecting a stale target and keeps unmapped bytes out of storage', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  A[Intake]\r\n  B[Archive]\r\n  A original@--> B\r\n';
  const project = { ...createDocument(), title: 'Table insertion target', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });
  async function openTarget(tab: Page, prepare: boolean) {
    await tab.goto('/');
    await tab.getByRole('button', { name: 'Manage projects' }).click();
    await tab.getByRole('button', { name: 'Project migration and recovery' }).click();
    if (prepare) await tab.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await tab.getByRole('button', { name: 'Open v3 project Table insertion target' }).click();
    const live = tab.getByRole('dialog', { name: project.title, exact: true });
    await expect(live.getByRole('img', { name: /Diagram preview for/ })).toBeVisible();
    return live;
  }

  async function snapshot(tab: Page, live: Locator) {
    const [file] = await Promise.all([
      tab.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click(),
    ]);
    const downloaded = await file.path();
    if (!downloaded) throw new Error('Missing table insertion project.');
    return JSON.parse(await readFile(downloaded, 'utf8'));
  }

  const raw = 'id,label,role,from,to,private\nx,Service,service,,,session-only-marker\ny,"Service",database,y,x,discard-from-checkpoint';
  const wizard = page.getByRole('dialog', { name: 'Insert relationship table', exact: true });
  const input = wizard.getByLabel('Paste a relationship table');
  const open = (live: Locator) => live.getByRole('button', { name: 'Insert relationship table', exact: true }).click();
  const original = await openTarget(page, true);
  await open(original);
  await input.fill(raw);
  await wizard.getByRole('button', { name: 'Close dialog' }).click();
  expect(await readDrafts(page)).toEqual([]);
  await open(original);
  await expect(input).toHaveValue(raw);

  const reloaded = await openTarget(page, false);
  await open(reloaded);
  await expect(input).toHaveValue('');
  await input.fill(raw);
  await wizard.getByRole('button', { name: 'Read table' }).click();
  await wizard.getByRole('combobox', { name: 'System label' }).selectOption('1');
  await wizard.getByRole('combobox', { name: 'System ID' }).selectOption('0');
  await wizard.getByRole('combobox', { name: 'Role', exact: true }).selectOption('2');
  await wizard.getByRole('combobox', { name: 'Relationship source' }).selectOption('3');
  await wizard.getByRole('combobox', { name: 'Relationship target' }).selectOption('4');
  await wizard.getByRole('button', { name: 'Review mapped relationships' }).click();
  await expect(wizard.getByRole('heading', { name: 'Review mapped systems' })).toBeFocused();
  await expect(wizard.getByText(/Draft saved locally · expires/)).toBeVisible();
  const stored = await readDrafts(page);
  expect(stored).toHaveLength(1);
  expect(JSON.stringify(stored)).not.toMatch(/session-only-marker|discard-from-checkpoint/);

  const attachment = wizard.getByRole('group', { name: 'Attachment to this project' });
  await attachment.getByRole('combobox', { name: 'Existing node', exact: true }).selectOption({ label: 'Intake (A)' });
  await attachment.getByRole('combobox', { name: 'Draft node', exact: true }).selectOption({ label: 'Service (row 3)' });
  await attachment.getByRole('combobox', { name: 'Attachment direction', exact: true }).selectOption('from-existing');
  const preview = wizard.getByRole('button', { name: 'Preview relationships', exact: true });
  const insert = wizard.getByRole('button', { name: 'Insert mapped systems', exact: true });
  await preview.click();
  await expect(insert).toBeEnabled();
  await expect(wizard.getByText('Attachment Intake (A) → Service (row 3)', { exact: true })).toBeVisible();
  await expect(wizard.getByRole('list', { name: 'Reviewed relationships' })).toHaveText('Service (row 3) → Service (row 2)');

  const second = await page.context().newPage();
  try {
    const other = await openTarget(second, false);
    await other.getByRole('button', { name: 'Edit heading' }).click();
    const heading = second.getByRole('dialog', { name: 'Edit heading' });
    await heading.getByRole('textbox', { name: 'Title', exact: true }).fill('Updated table target');
    await heading.getByRole('button', { name: 'Apply heading' }).click();
    const updated = second.getByRole('dialog', { name: 'Updated table target', exact: true });
    await expect(updated.getByText('Saved in this browser.')).toBeVisible();
    const changed = await snapshot(second, updated);

    await insert.click();
    await expect(wizard.getByRole('alert')).toContainText('The saved project changed.');
    await expect(wizard.getByText('Relationship source uses column 4')).toBeVisible();
    await expect(attachment.getByRole('combobox', { name: 'Draft node', exact: true })).toHaveValue('row-3');
    expect(await snapshot(second, updated)).toEqual(changed);
    await preview.click();
    await expect(wizard.getByText('2 systems · 1 relationships · Updated table target')).toBeVisible();
    await insert.click();

    const live = page.getByRole('dialog', { name: 'Updated table target', exact: true });
    await expect(live.getByText('Saved in this browser.')).toBeVisible();
    const accepted = await snapshot(page, live);
    expect(accepted.source).toBe(source + [
      '  m_n1["Service"]', '  m_n2["Service"]', '  m_n2 m_e1@--> m_n1', '  A m_e2@--> m_n2', '',
    ].join('\r\n'));
    expect(accepted.roles.map((item: { role: string }) => item.role)).toEqual(['service', 'database']);
    expect(await readDrafts(page)).toEqual([]);
    await live.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(live.getByText('Saved in this browser.')).toBeVisible();
    const restored = await snapshot(page, live);
    expect(restored).toEqual({ ...changed, revision: accepted.revision + 1, updatedAt: restored.updatedAt });
  } finally { await second.close(); }
});
