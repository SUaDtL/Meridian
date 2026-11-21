import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

async function openFixture(page: Page) {
  const project = { ...createDocument(), title: 'Unresolved records', source: 'flowchart LR\n A[Current]\n B[Other]\n A link@--> B\n' };
  project.design.elements['node:Former'] = { fill: '#123456' };
  project.design.elements['node:Keep'] = { color: '#abcdef' };
  project.storyboard = { version: 1, loop: false, scenes: [
    { ...createScene(), title: 'Former scene', visible: ['node:Former', 'node:A'] },
  ] };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key,
    JSON.stringify({ version: 2, activeId: project.id, documents: [project] })), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Unresolved records' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project backup.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  return { live, download };
}

test('reviews hidden unresolved annotations and removes only the confirmed records with one Undo', async ({ page }, info) => {
  const { live, download } = await openFixture(page);
  const original = await download();
  expect(original.identity.orphans).toHaveLength(2);
  const open = live.getByRole('button', { name: 'Review unresolved annotations' });
  const annotations = page.getByRole('dialog', { name: 'Unresolved annotations' });
  await open.click();
  const search = annotations.getByRole('searchbox', { name: 'Find an annotation' });
  await expect(search).toBeFocused();
  await annotations.getByRole('checkbox', { name: 'node:Former' }).check();
  await search.fill('Keep');
  await expect(annotations.getByRole('status')).toHaveText('1 selected · 1 hidden · 2 unresolved');
  await annotations.getByRole('button', { name: 'Review removal' }).click();
  const scope = annotations.getByRole('region', { name: 'Annotations to remove' });
  await expect(scope.getByRole('heading', { name: 'Review annotation removal' })).toBeFocused();
  await expect(scope).toContainText('This includes 1 outside the visible results.');
  await expect(scope.getByRole('listitem')).toContainText('Appearance settings');
  await expect(scope.getByRole('listitem')).toContainText('Scene references in Former scene');
  await expect(scope).not.toContainText('node:Keep');
  await page.screenshot({ path: info.outputPath('annotation-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('annotation-review-mobile.png') });
  await annotations.getByRole('button', { name: 'Close dialog' }).click();
  expect(await download()).toEqual(original);
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
  await open.click();
  await annotations.getByRole('checkbox', { name: 'node:Former' }).check();
  await annotations.getByRole('button', { name: 'Review removal' }).click();
  await annotations.getByRole('button', { name: 'Remove reviewed annotations' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const cleaned = await download();
  expect(cleaned).toEqual({ ...original, revision: original.revision + 1, updatedAt: cleaned.updatedAt,
    identity: { ...original.identity, orphans: original.identity.orphans.filter((item: { legacyKey: string }) => item.legacyKey !== 'node:Former') },
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored).toEqual({ ...original, revision: cleaned.revision + 1, updatedAt: restored.updatedAt });
});

test('reattaches one reviewed appearance and scene annotation to a compatible current node', async ({ page }, info) => {
  const { live, download } = await openFixture(page);
  const original = await download();
  const orphan = original.identity.orphans.find((record: { legacyKey: string }) => record.legacyKey === 'node:Former');
  const target = original.identity.elements.find((record: { binding: { sourceId: string } }) => record.binding.sourceId === 'B');
  await live.getByRole('button', { name: 'Review unresolved annotations' }).click();
  const annotations = page.getByRole('dialog', { name: 'Unresolved annotations' });
  await annotations.getByRole('checkbox', { name: 'node:Former' }).check();
  await annotations.getByRole('button', { name: 'Reattach selected annotation' }).click();
  const reattach = annotations.getByRole('region', { name: 'Reattach an annotation' });
  await expect(reattach).toContainText('Scene references in Former scene');
  const destination = reattach.getByRole('combobox', { name: 'Destination' });
  await expect(destination).toBeFocused();
  await expect(destination.getByRole('option')).toHaveCount(3);
  await destination.selectOption({ label: 'Current (A)' });
  const preview = reattach.getByRole('button', { name: 'Preview reattachment' });
  const apply = reattach.getByRole('button', { name: 'Apply reviewed reattachment' });
  await preview.click();
  await expect(annotations.getByRole('alert')).toContainText('A scene target already exists at this destination');
  await expect(apply).toBeDisabled();
  await destination.selectOption({ label: 'Other (B)' });
  await preview.click();
  await expect(reattach.getByRole('region', { name: 'Proposed annotation reattachment' })).toContainText('node:Former will attach to Other.');
  await expect(apply).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('annotation-reattachment-mobile.png') });
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const applied = await download();
  expect(applied).toEqual({ ...original, revision: original.revision + 1, updatedAt: applied.updatedAt,
    identity: { ...original.identity, orphans: original.identity.orphans.filter((record: { id: string }) => record.id !== orphan.id) },
    design: { ...original.design, elements: { ...original.design.elements, [target.id]: orphan.retained.style } },
    storyboard: { ...original.storyboard, scenes: [
      { ...original.storyboard.scenes[0], visible: [target.id, ...original.storyboard.scenes[0].visible] },
    ] },
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored).toEqual({ ...original, revision: applied.revision + 1, updatedAt: restored.updatedAt });
});
