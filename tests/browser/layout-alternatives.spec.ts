import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function downloadProject(page: Page, live: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await download.path();
  if (!path) throw new Error('Missing project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('compares measured layouts and undoes an exact direction patch with the chosen settings', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  %% keep the LR explanation\r\n  A["Client LR"]\r\n  B["Service"]\r\n  A main@-->|"Call"| B\r\n';
  const project = { ...createDocument(), title: 'Layout comparison', source };
  project.design.elements['node:A'] = { fill: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Layout comparison' }).click();
  const live = page.getByRole('dialog', { name: 'Layout comparison' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Layout comparison' })).toBeVisible();
  const original = await downloadProject(page, live);

  await live.getByRole('button', { name: 'Compare layouts', exact: true }).click();
  const layouts = page.getByRole('dialog', { name: 'Compare layouts' });
  const choices = layouts.getByRole('group', { name: 'Layout alternatives' });
  await expect(choices.getByRole('button')).toHaveCount(3);
  await choices.getByRole('button', { name: /Compact/ }).click();
  await layouts.getByRole('combobox', { name: 'Source direction' }).selectOption('TB');
  const apply = layouts.getByRole('button', { name: 'Apply Compact', exact: true });
  await expect(apply).toBeDisabled();
  await layouts.getByRole('button', { name: 'Preview Compact', exact: true }).click();
  await expect(layouts.getByRole('img', { name: 'Proposed Compact layout' })).toBeVisible();
  await expect(layouts.getByRole('list', { name: 'Layout changes' })).toContainText('Source direction · LR → TB');
  const measured = layouts.getByRole('region', { name: 'Viewed label sizes' });
  await expect(measured).toContainText('Viewed labels at 1280 × 720 CSS pixels');
  await expect(measured.getByText(/Current · .* measured/)).toBeVisible();
  await expect(measured.getByText(/Proposed · .* measured/)).toBeVisible();
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const applied = await downloadProject(page, live);
  expect(applied.source).toBe(source.replace('flowchart LR', 'flowchart TB'));
  expect(applied.settings).toMatchObject({ layout: 'dagre', spacing: 'compact', curve: 'linear' });
  expect(applied.identity).toEqual(original.identity);
  expect(applied.design).toEqual(original.design);

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored.source).toBe(source);
  expect(restored.settings).toEqual(original.settings);
});
