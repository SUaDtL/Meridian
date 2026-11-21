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

test('reviews hidden incident edges and keeps a recreated source ID separate from its retired scene and style', async ({ page }) => {
  const source = 'flowchart LR\nA[First]\nB[Middle]\nC[Last]\nA incoming@-->|"Enter"| B\nA kept@--> C\nB outgoing@-->|"Leave"| C\nlinkStyle 0,1,2 stroke:#123456\n';
  const middle = 'node:B';
  const incoming = 'edge:id:incoming';
  const outgoing = 'edge:id:outgoing';
  const scene = { ...createScene(), title: 'Middle scene', visible: ['node:A', middle, outgoing], highlight: [middle, incoming],
    flow: [incoming, outgoing], camera: { mode: 'elements' as const, keys: [middle, 'node:C'], padding: 20 } };
  const project = { ...createDocument(), title: 'Delete a node', source, storyboard: { version: 1 as const, scenes: [scene], loop: false } };
  project.design.elements[middle] = { stroke: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Delete a node' }).click();
  const live = page.getByRole('dialog', { name: 'Delete a node' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Delete a node' })).toBeVisible();
  const original = await downloadProject(page, live);
  const ids = new Map<string, string>(original.identity.elements.map((item: { id: string; binding: { sourceId: string } }) => [item.binding.sourceId, item.id]));
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('button', { name: 'Relationships', exact: true }).click();
  const filter = outline.getByRole('textbox', { name: 'Find an element' });
  await filter.fill('Middle');
  await outline.getByRole('button', { name: 'Select visible results' }).click();
  await expect(outline.getByRole('status')).toHaveText('2 selected · 0 hidden');
  await filter.fill('Enter');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await expect(outline.getByRole('option', { name: /Leave/ })).toHaveCount(0);
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await edit.getByRole('combobox', { name: 'Operation' }).selectOption('removeNode');
  await edit.getByRole('combobox', { name: 'Node to delete' }).selectOption({ label: 'Middle (B)' });
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const impact = edit.getByRole('region', { name: 'Deletion impact' });
  await expect(impact).toContainText('Incident connections to remove (2)');
  await expect(impact.getByRole('listitem').filter({ hasText: 'Enter' })).toBeVisible();
  await expect(impact.getByRole('listitem').filter({ hasText: 'Leave' })).toBeVisible();
  await expect(impact).toContainText('7 scene references will be kept as unresolved annotations.');
  await expect(impact.getByRole('listitem').filter({ hasText: 'Middle scene' })).toBeVisible();
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const removed = await downloadProject(page, live);
  expect(removed.source).toBe('flowchart LR\nA[First]\n\nC[Last]\n\nA kept@--> C\n\nlinkStyle 0 stroke:#123456\n');
  for (const removedSourceId of ['B', 'incoming', 'outgoing']) {
    const id = ids.get(removedSourceId);
    expect(removed.identity.elements).toContainEqual(expect.objectContaining({ id, status: 'retired' }));
    expect(removed.identity.orphans).toContainEqual(expect.objectContaining({ formerElementId: id, reason: 'retired' }));
  }
  expect(removed.identity.elements).toContainEqual(expect.objectContaining({ id: ids.get('kept'), status: 'resolved' }));
  expect(removed.storyboard.scenes[0].camera.keys).toEqual([ids.get('C')]);

  await live.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  const sourceEditor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const recreatedSource = removed.source + 'B[Recreated system]\n';
  await sourceEditor.getByRole('textbox', { name: 'Mermaid source' }).fill(recreatedSource);
  await sourceEditor.getByRole('button', { name: 'Preview source' }).click();
  await expect(sourceEditor.getByRole('region', { name: 'Proposed source edit' })).toContainText('3 existing bindings preserved · 1 new binding');
  await sourceEditor.getByRole('button', { name: 'Apply source' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const recreated = await downloadProject(page, live);
  const sameSourceId = recreated.identity.elements.filter((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'B');
  expect(sameSourceId).toHaveLength(2);
  expect(sameSourceId).toContainEqual(expect.objectContaining({ id: ids.get('B'), status: 'retired' }));
  const current = sameSourceId.find((item: { status: string }) => item.status === 'resolved');
  expect(current.id).not.toBe(ids.get('B'));
  expect(recreated.source).toBe(recreatedSource);
  expect(recreated.storyboard).toEqual(removed.storyboard);
  expect(recreated.design).toEqual(removed.design);
  expect(recreated.identity.orphans).toEqual(removed.identity.orphans);
  expect(recreated.design.elements[current.id]).toBeUndefined();
  await live.getByRole('button', { name: 'Review unresolved annotations' }).click();
  const unresolved = page.getByRole('dialog', { name: 'Unresolved annotations' });
  const oldNode = unresolved.getByRole('listitem').filter({ has: page.getByRole('checkbox', { name: 'node:B', exact: true }) });
  await expect(oldNode).toContainText('Appearance settings · Scene references in Middle scene');
  await unresolved.getByRole('button', { name: 'Close dialog' }).click();

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const beforeRecreation = await downloadProject(page, live);
  expect(beforeRecreation).toEqual({ ...removed, revision: recreated.revision + 1, updatedAt: beforeRecreation.updatedAt });

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored).toEqual({ ...original, revision: beforeRecreation.revision + 1, updatedAt: restored.updatedAt });
});
