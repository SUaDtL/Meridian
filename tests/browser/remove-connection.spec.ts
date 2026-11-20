import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

async function downloadProject(page: Page, live: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await download.path();
  if (!path) throw new Error('Missing project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('reviews a connection deletion, preserves retired scene references, and restores it exactly with Undo', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  A[First]\r\n  B[Second]\r\n  C[Third]\r\n  A one@--> B\r\n  A middle@-->|"Skip"| C\r\n  B tail@--> C\r\n  linkStyle 0 stroke:#aaaaaa\r\n  linkStyle 1 stroke:#123456\r\n  linkStyle 2 stroke:#654321\r\n';
  const oldEdge = 'edge:id:middle';
  const scene = { ...createScene(), title: 'Shortcut scene', visible: ['node:A', oldEdge], highlight: [oldEdge], flow: [oldEdge],
    camera: { mode: 'elements' as const, keys: [oldEdge, 'node:C'], padding: 20 } };
  const project = { ...createDocument(), title: 'Delete a connection', source, storyboard: { version: 1 as const, scenes: [scene], loop: false } };
  project.design.elements[oldEdge] = { stroke: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Delete a connection' }).click();
  const live = page.getByRole('dialog', { name: 'Delete a connection' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Delete a connection' })).toBeVisible();
  const original = await downloadProject(page, live);
  const edge = original.identity.elements.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'middle');

  await live.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await edit.getByRole('combobox', { name: 'Operation' }).selectOption('removeEdge');
  await edit.getByRole('combobox', { name: 'Connection to delete' }).selectOption(edge.id);
  const apply = edit.getByRole('button', { name: 'Apply change' });
  await expect(apply).toBeDisabled();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const impact = edit.getByRole('region', { name: 'Deletion impact' });
  await expect(impact).toContainText('Shortcut scene');
  await expect(impact).toContainText('4 scene references will be kept as unresolved annotations.');
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const removed = await downloadProject(page, live);
  expect(removed.source).toBe(source.replace('A middle@-->|"Skip"| C', '').replace('linkStyle 1 stroke:#123456', '').replace('linkStyle 2', 'linkStyle 1'));
  expect(removed.identity.elements.find((item: { id: string }) => item.id === edge.id)).toEqual({ ...edge, status: 'retired' });
  expect(removed.identity.orphans).toContainEqual(expect.objectContaining({ formerElementId: edge.id, reason: 'retired', retained: {
    style: { stroke: '#abcdef' }, sceneReferences: [
      { sceneId: scene.id, field: 'visible', index: 1 }, { sceneId: scene.id, field: 'highlight', index: 0 },
      { sceneId: scene.id, field: 'flow', index: 0 }, { sceneId: scene.id, field: 'camera', index: 0 },
    ],
  } }));
  expect(removed.storyboard.scenes[0].flow).toEqual([]);
  expect(removed.design.elements[edge.id]).toBeUndefined();
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored.source).toBe(original.source);
  expect(restored.identity).toEqual(original.identity);
  expect(restored.storyboard).toEqual(original.storyboard);
  expect(restored.design).toEqual(original.design);
});
