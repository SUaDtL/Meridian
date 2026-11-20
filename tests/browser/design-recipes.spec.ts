import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function downloadProject(page: Page, live: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await download.path();
  if (!path) throw new Error('Missing project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('compares a design recipe, preserves source and overrides, and undoes the applied settings together', async ({ page }) => {
  const source = 'flowchart LR\n A["Client"]\n B["Service"]\n A main@--> B\n';
  const project = { ...createDocument(), title: 'Recipe comparison', source };
  project.design.elements['node:A'] = { fill: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Recipe comparison' }).click();
  const live = page.getByRole('dialog', { name: 'Recipe comparison' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Recipe comparison' })).toBeVisible();
  const original = await downloadProject(page, live);

  await live.getByRole('button', { name: 'Explore designs', exact: true }).click();
  const designs = page.getByRole('dialog', { name: 'Explore designs' });
  const choices = designs.getByRole('group', { name: 'Design recipes' });
  await expect(choices.getByRole('button')).toHaveCount(3);
  await choices.getByRole('button', { name: /Presentation/ }).click();
  const apply = designs.getByRole('button', { name: 'Apply Presentation', exact: true });
  await expect(apply).toBeDisabled();
  await designs.getByRole('button', { name: 'Preview Presentation', exact: true }).click();
  await expect(designs.getByRole('img', { name: 'Proposed Presentation design' })).toBeVisible();
  await expect(designs.getByRole('list', { name: 'Design changes' })).toContainText('Frame · auto → 16:9');
  await designs.getByRole('button', { name: 'Current', exact: true }).click();
  await expect(designs.getByRole('img', { name: 'Current diagram design' })).toBeVisible();
  await designs.getByRole('button', { name: 'Proposed', exact: true }).click();
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const applied = await downloadProject(page, live);
  expect(applied.revision).toBe(1);
  expect(applied.design.recipe).toEqual({ id: 'presentation', version: '1.0.0' });
  expect(applied.settings).toMatchObject({ frame: '16:9', padding: 64 });
  expect(applied.source).toBe(source);
  expect(applied.design.elements).toEqual(original.design.elements);
  expect(applied.identity).toEqual(original.identity);

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored.revision).toBe(2);
  expect(restored.settings).toEqual(original.settings);
  expect(restored.design).toEqual(original.design);
});
