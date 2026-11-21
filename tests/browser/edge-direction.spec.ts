import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

test('reviews explicit connection direction and requires consent for an identical symmetric connection', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n A[Client]\r\n B[Service]\r\n A exchange@<-->|"Exchange"| B\r\n';
  const project = { ...createDocument(), title: 'Connection review', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Connection review' }).click();
  const live = page.getByRole('dialog', { name: 'Connection review' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Connection review' })).toBeVisible();
  async function download() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing connection review project.');
    return JSON.parse(await readFile(path, 'utf8'));
  }

  const original = await download();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Service/ }).click();
  const connect = outline.getByRole('button', { name: 'Connect from selected node' });
  await connect.click();
  const form = page.getByRole('dialog', { name: 'Edit flowchart' });
  const from = form.getByRole('combobox', { name: 'From', exact: true });
  await expect(from.locator('option:checked')).toHaveText('Service (B)');
  await form.getByRole('button', { name: 'Close dialog' }).click();
  await expect(connect).toBeFocused();
  await outline.getByRole('button', { name: 'Close dialog' }).click();

  await live.getByRole('button', { name: 'Commands', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Commands' }).getByRole('combobox');
  await search.fill('Connect nodes');
  await search.press('Enter');
  await expect(from.locator('option:checked')).toHaveText('Service (B)');
  const endpointQuery = form.getByRole('textbox', { name: 'Find connection endpoints' });
  await endpointQuery.fill('Service');
  await form.getByRole('combobox', { name: 'From', exact: true }).selectOption({ label: 'Service (B)' });
  await endpointQuery.fill('Client');
  await expect(form.getByRole('combobox', { name: 'From', exact: true }).locator('option:checked')).toHaveText('Service (B)');
  await form.getByRole('combobox', { name: 'To', exact: true }).selectOption({ label: 'Client (A)' });
  await form.getByRole('textbox', { name: 'Connection label (optional)' }).fill('Exchange');
  await form.getByRole('combobox', { name: 'Connection direction' }).selectOption('both');
  const preview = form.getByRole('button', { name: 'Preview change' });
  await expect(preview).toBeDisabled();
  await form.getByRole('checkbox', { name: 'Add another identical connection' }).check();
  await preview.click();
  await expect(form.getByRole('img', { name: 'Proposed diagram' })).toBeVisible();
  await form.getByRole('combobox', { name: 'Connection direction' }).selectOption('none');
  await expect(form.getByRole('checkbox', { name: 'Add another identical connection' })).toHaveCount(0);
  await preview.click();
  await expect(form.getByRole('img', { name: 'Proposed diagram' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('connection-direction-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('connection-direction-mobile.png') });
  await form.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const saved = await download();
  expect(saved.source).toBe(source + '  B m_e1@---|"Exchange"| A\r\n');
  await expect(live.getByRole('img', { name: 'Diagram preview for Connection review' })).toBeVisible();
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  await outline.getByRole('button', { name: 'Relationships' }).click();
  await expect(outline.getByRole('option', { name: /Client ↔ Service.*exchange/ })).toBeVisible();
  await expect(outline.getByRole('option', { name: /Service – Client.*m_e1/ })).toBeVisible();
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = await download();
  expect(undone).toEqual({ ...original, revision: saved.revision + 1, updatedAt: undone.updatedAt });
});

test('makes the same searchable connection with keyboard and touch without dragging', async ({ page, browser }, info) => {
  const source = '\uFEFFflowchart LR\r\n  A[Intake]\r\n  B[Service]\r\n  C[Service]\r\n  D[Archive]\r\n';
  const project = { ...createDocument(), title: 'Searchable connection parity', source };
  async function connect(at: typeof page, touch: boolean) {
    await at.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
      version: 2, activeId: project.id, documents: [project],
    })), { key: STORAGE_KEY, project });
    await at.goto('/');
    await at.getByRole('button', { name: 'Manage projects' }).click();
    await at.getByRole('button', { name: 'Project migration and recovery' }).click();
    await at.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await at.getByRole('button', { name: 'Open v3 project Searchable connection parity' }).click();
    const live = at.getByRole('dialog', { name: project.title, exact: true });
    await expect(live.getByRole('img', { name: /Diagram preview for/ })).toBeVisible();
    if (touch) await live.getByRole('button', { name: 'Commands', exact: true }).tap();
    else await at.keyboard.press('Control+k');
    const commands = at.getByRole('dialog', { name: 'Commands' });
    const command = commands.getByRole('combobox');
    await command.fill('Connect nodes');
    if (touch) await commands.getByRole('option', { name: /Connect nodes/ }).tap();
    else await command.press('Enter');

    const form = at.getByRole('dialog', { name: 'Edit flowchart' });
    const search = form.getByRole('textbox', { name: 'Find connection endpoints' });
    const from = form.getByRole('combobox', { name: 'From', exact: true });
    const to = form.getByRole('combobox', { name: 'To', exact: true });
    await search.fill('Intake');
    if (touch) await from.selectOption({ label: 'Intake (A)' });
    else await from.press('End');
    await expect(from.locator('option:checked')).toHaveText('Intake (A)');
    await search.fill('Service (C)');
    await expect(to.getByRole('option', { name: 'Service (B)', exact: true })).toHaveCount(0);
    if (touch) await to.selectOption({ label: 'Service (C)' });
    else await to.press('End');
    await expect(from.locator('option:checked')).toHaveText('Intake (A)');
    await expect(to.locator('option:checked')).toHaveText('Service (C)');
    await form.getByRole('textbox', { name: 'Connection label (optional)' }).fill('Sends');
    const preview = form.getByRole('button', { name: 'Preview change' });
    if (touch) await preview.tap();
    else await preview.press('Enter');
    await expect(form.getByRole('img', { name: 'Proposed diagram' })).toBeVisible();
    await at.screenshot({ path: info.outputPath(touch ? 'connection-search-touch.png' : 'connection-search-keyboard.png') });
    const apply = form.getByRole('button', { name: 'Apply change' });
    if (touch) await apply.tap();
    else await apply.press('Enter');
    await expect(live.getByText('Saved in this browser.')).toBeVisible();
    const [file] = await Promise.all([
      at.waitForEvent('download'),
      live.getByRole('button', { name: 'Download v3 project' }).click(),
    ]);
    const path = await file.path();
    if (!path) throw new Error('Missing reviewed connection project.');
    const accepted = JSON.parse(await readFile(path, 'utf8'));
    expect(accepted.revision).toBe(1);
    expect(accepted.identity.elements).toHaveLength(5);
    return accepted.source as string;
  }

  const keyboardSource = await connect(page, false);
  expect(keyboardSource).toBe(source + '  A m_e1@-->|"Sends"| C\r\n');
  const touch = await browser.newPage({
    baseURL: new URL(page.url()).origin, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, acceptDownloads: true,
  });
  try {
    expect(await connect(touch, true)).toBe(keyboardSource);
  } finally { await touch.close(); }
});
