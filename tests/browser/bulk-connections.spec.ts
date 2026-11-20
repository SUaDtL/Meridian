import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

test('reviews a hidden bulk connection selection and preserves neighboring notation and annotations through Undo', async ({ page }) => {
  const first = 'A first@-->|"Drop first"| B';
  const last = 'B last@-->|"Drop last"| C';
  const style = 'linkStyle 2 stroke:#626262';
  const source = [
    '\uFEFFflowchart LR', '  A[Start]', '  B[Middle]', '  C[Finish]', `  ${first}`, '  A keep@-->|"Keep this"| B',
    `  ${last}`, '  linkStyle 0,1 stroke:#123456', `  ${style}`, '  %% retain this line', '',
  ].join('\r\n');
  const scene = { ...createScene(), title: 'Linked scene', highlight: ['edge:id:first', 'edge:id:last'] };
  const project = { ...createDocument(), title: 'Connection selection', source, storyboard: { version: 1 as const, scenes: [scene], loop: false } };
  project.design.elements['edge:id:first'] = { stroke: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Connection selection' }).click();
  const live = page.getByRole('dialog', { name: 'Connection selection' });
  async function download() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing bulk connection project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const before = await download();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Start/ }).click();
  await outline.getByRole('button', { name: 'Relationships', exact: true }).click();
  const filter = outline.getByRole('textbox', { name: 'Find an element' });
  await filter.fill('Drop');
  await outline.getByRole('button', { name: 'Select visible results' }).click();
  const remove = outline.getByRole('button', { name: 'Delete selected connections' });
  await expect(remove).toBeDisabled();
  await outline.getByRole('button', { name: 'Clear selection' }).click();
  await outline.getByRole('button', { name: 'Select visible results' }).click();
  await filter.fill('Drop first');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await remove.click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  const selected = edit.getByRole('region', { name: 'Connections to delete' });
  await expect(selected).toContainText('2 selected · 1 hidden in the outline');
  await expect(selected).toContainText('(first)');
  await expect(selected).toContainText('(last)');
  await expect(edit.getByRole('button', { name: 'Apply change' })).toBeDisabled();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const impact = edit.getByRole('region', { name: 'Deletion impact' });
  await expect(impact).toContainText('2 scene references');
  await expect(impact).toContainText('Appearance settings for 1 removed element');
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = await download();
  expect(after.source).toBe(source.replace(first, '').replace(last, '').replace(style, '').replace('linkStyle 0,1', 'linkStyle 0'));
  const ids = new Map(before.identity.elements.map((item: { id: string; binding: { sourceId: string } }) => [item.binding.sourceId, item.id]));
  expect(after.identity.elements).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.get('keep'), status: 'resolved' })]));
  expect(after.identity.orphans.map((item: { formerElementId: string }) => item.formerElementId).sort()).toEqual([ids.get('first'), ids.get('last')].sort());
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored).toEqual({ ...before, revision: after.revision + 1, updatedAt: restored.updatedAt });
});
