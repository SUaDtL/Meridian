import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

async function download(page: Page, live: Locator, button: string) {
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: button, exact: true }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing project download.');
  return readFile(path, 'utf8');
}

test('appends reviewed group scenes, keeps ancestor containers scoped, and exports the same settled visibility', async ({ page, browser }) => {
  const source = 'flowchart LR\n subgraph Outer [Outer group]\n   A[Start]\n   subgraph Inner [Inner group]\n     B[Selected input]\n     D[Selected output]\n   end\n   C[Finish]\n end\n E[External]\n A main@--> C\n B local@--> D\n A boundary@--> E\n';
  const existing = { ...createScene(), title: 'Manual overview' };
  const project = { ...createDocument(), title: 'Group story example', source, storyboard: { version: 1 as const, scenes: [existing], loop: false } };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Group story example' }).click();
  const live = page.getByRole('dialog', { name: 'Group story example' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Group story example' })).toBeVisible();
  const original = JSON.parse(await download(page, live, 'Download v3 project'));
  const bindings = new Map(original.identity.elements.map((record: { binding: { sourceId: string }; id: string }) => [record.binding.sourceId, record.id]));
  const hidden = `[data-element-key="${bindings.get('A')}"]`;
  const shown = `[data-element-key="${bindings.get('B')}"]`;
  const ancestor = `[data-element-key="${bindings.get('Outer')}"]`;

  await live.getByRole('button', { name: 'Suggest scenes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest scenes' });
  await dialog.getByRole('checkbox', { name: 'Include a diagram overview' }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Include group Outer group' }).check();
  await dialog.getByRole('checkbox', { name: 'Include group Inner group' }).check();
  await dialog.getByRole('group', { name: 'Inner group', exact: true }).getByRole('button', { name: 'Move earlier' }).click();
  await dialog.getByRole('checkbox', { name: 'Animate visible directional connections' }).check();
  await dialog.getByRole('button', { name: 'Preview 2 scenes' }).click();
  const coverage = dialog.getByRole('list', { name: 'Suggested scene coverage' });
  await expect(coverage.getByRole('listitem').first()).toContainText('Inner group');
  await expect(coverage.getByRole('listitem').first()).toContainText('2 nodes, 1 connection, and 2 groups shown.');
  await expect(dialog.locator(hidden)).toHaveAttribute('aria-hidden', 'true');
  await expect(dialog.locator(shown)).toHaveAttribute('aria-hidden', 'false');
  await expect(dialog.locator(ancestor)).toHaveAttribute('aria-hidden', 'false');
  await dialog.getByRole('button', { name: 'Append suggested scenes' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const saved = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(saved.source).toBe(source);
  expect(saved.storyboard.scenes[0]).toEqual(original.storyboard.scenes[0]);
  expect(saved.storyboard.scenes.slice(1).map((item: { title: string }) => item.title)).toEqual(['Inner group', 'Outer group']);
  expect(saved.storyboard.scenes[1].flow).toEqual([bindings.get('local')]);
  expect(saved.storyboard.scenes[1].visible).not.toContain(bindings.get('A'));

  const html = await download(page, live, 'Download HTML presentation');
  const offline = await browser.newContext({ offline: true, reducedMotion: 'reduce' });
  try {
    const presentation = await offline.newPage();
    await presentation.setContent(html);
    await presentation.getByLabel('Choose scene', { exact: true }).selectOption('1');
    await expect(presentation.locator(hidden)).toHaveAttribute('aria-hidden', 'true');
    await expect(presentation.locator(shown)).toHaveAttribute('aria-hidden', 'false');
    await expect(presentation.locator(ancestor)).toHaveAttribute('aria-hidden', 'false');
  } finally { await offline.close(); }

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(restored.storyboard).toEqual(original.storyboard);
});
