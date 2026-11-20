import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

test('changes and clears one parallel edge label while preserving its identity, neighboring source and storyboard', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n A[First]\r\n B[Second]\r\n A first@-->|"Reviewed link"|  B\r\n %% preserved\r\n A other@-->|"Reviewed link"| B\r\n linkStyle 1 stroke:#123456\r\n';
  const scene = { ...createScene(), visible: ['node:A', 'node:B', 'edge:id:first'], highlight: ['edge:id:first'] };
  const project = { ...createDocument(), title: 'Connection label example', source,
    storyboard: { version: 1 as const, scenes: [scene], loop: false } };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Connection label example' }).click();
  const live = page.getByRole('dialog', { name: 'Connection label example' });
  async function readProject() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  await expect(live.getByRole('img', { name: 'Diagram preview for Connection label example' })).toBeVisible();
  const before = await readProject();
  const target = before.identity.elements.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'first');
  const dialog = page.getByRole('dialog', { name: 'Edit flowchart' });
  async function edit(expectLabel: string, nextLabel: string) {
    await live.getByRole('button', { name: 'Commands', exact: true }).click();
    const commands = page.getByRole('dialog', { name: 'Commands' });
    const search = commands.getByRole('combobox');
    await search.fill('Edit connection label');
    await search.press('Enter');
    await dialog.getByRole('combobox', { name: 'Connection to edit' }).selectOption(target.id);
    const input = dialog.getByRole('textbox', { name: 'Connection label (optional)' });
    await expect(input).toHaveValue(expectLabel);
    await input.fill(nextLabel);
    await dialog.getByRole('button', { name: 'Preview change' }).click();
    await expect(dialog.getByRole('img')).toBeVisible();
  }
  await edit('Reviewed link', 'New link');
  await page.screenshot({ path: info.outputPath('edge-label-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('edge-label-review-mobile.png') });
  await dialog.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const renamed = await readProject();
  expect(renamed).toEqual({
    ...before, revision: before.revision + 1, updatedAt: renamed.updatedAt,
    source: source.replace('first@-->|"Reviewed link"|', 'first@-->|"New link"|'),
  });
  await edit('New link', '');
  await dialog.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const cleared = await readProject();
  expect(cleared.source).toBe(source.replace('first@-->|"Reviewed link"|', 'first@-->'));
  expect(cleared.storyboard).toEqual(before.storyboard);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await readProject();
  expect(restored).toEqual({ ...renamed, revision: cleared.revision + 1, updatedAt: restored.updatedAt });
});
