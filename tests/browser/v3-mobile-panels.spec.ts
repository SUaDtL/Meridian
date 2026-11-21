import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function download(page: Page, live: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing source edit project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('keeps a mobile source draft while moving through the four workspace panels', async ({ page }, info) => {
  const source = 'flowchart LR\n  A[Start] --> B[Finish]\n';
  const draft = source.replace('Finish', 'Review result');
  const project = { ...createDocument(), title: 'Mobile authoring', source };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Mobile authoring' }).click();
  const live = page.getByRole('dialog', { name: 'Mobile authoring' });
  const navigation = live.getByRole('navigation', { name: 'Workspace panels' });
  await expect(navigation.getByRole('button')).toHaveText(['Build', 'Canvas', 'Design', 'Story']);
  const button = (name: string) => navigation.getByRole('button', { name, exact: true });
  const image = live.getByRole('img', { name: 'Diagram preview for Mobile authoring' });
  const edit = live.getByRole('button', { name: 'Edit Mermaid source', exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  const bounds = await image.boundingBox();
  if (!bounds) throw new Error('Missing mobile canvas dimensions.');
  await expect(button('Canvas')).toHaveAttribute('aria-pressed', 'true');
  await expect(edit).toHaveCount(0);
  await button('Build').press('Enter');
  await expect(image).toHaveCount(0);
  await edit.click();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const input = editor.getByRole('textbox', { name: 'Mermaid source' });
  await input.fill(draft);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(edit).toBeFocused();
  await button('Design').press('Enter');
  await expect(live.getByRole('button', { name: 'Check readability' })).toBeVisible();
  await expect(edit).toHaveCount(0);
  await live.locator('[data-v3-panel="Build"] button').first().evaluate((element: HTMLButtonElement) => element.focus());
  await expect(button('Design')).toBeFocused();
  await live.getByRole('button', { name: 'Check readability' }).click();
  const readability = page.getByRole('dialog', { name: 'Check readability' });
  await expect(readability.getByRole('combobox', { name: 'Viewing profile' })).toHaveValue('canvas');
  await expect(readability.getByText(`${Math.floor(bounds.width)} × ${Math.floor(bounds.height)} CSS pixels · 0 pixels of padding · Project revision 0`)).toBeVisible();
  await readability.getByRole('button', { name: 'Close dialog' }).click();
  await button('Story').press('Enter');
  await expect(live.getByRole('button', { name: 'Suggest scenes' })).toBeVisible();
  await expect(live.getByRole('button', { name: 'Check readability' })).toHaveCount(0);
  await button('Canvas').press('Enter');
  await expect(image).toBeVisible();
  expect((await download(page, live)).source).toBe(source);
  await expect(live.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('v3-workspace-mobile.png') });
  await button('Build').press('Enter');
  await edit.click();
  await expect(input).toHaveValue(draft);
});
