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

test('appends and edits ordinary group scenes, then exports the same settled visibility', async ({ page, browser }, info) => {
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

  await live.getByRole('button', { name: 'Edit saved scenes', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit saved scenes' });
  await editor.getByRole('button', { name: /^2\. Inner group/ }).click();
  await editor.getByRole('textbox', { name: 'Scene title' }).fill('Review handoff');
  await editor.getByRole('spinbutton', { name: 'Duration in seconds' }).fill('8');
  await editor.getByRole('spinbutton', { name: 'Entrance in seconds' }).fill('0.65');
  await editor.getByRole('combobox', { name: 'Entrance easing' }).selectOption('ease-out');
  await editor.getByRole('combobox', { name: 'Reveal order' }).selectOption('sequence');
  await editor.getByRole('spinbutton', { name: 'Camera padding in diagram units' }).fill('12');
  await expect(editor.getByRole('button', { name: 'Apply scene edit' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Preview scene edit' }).click();
  const proposed = editor.getByRole('region', { name: 'Proposed scene' });
  await expect(proposed.getByRole('button', { name: 'Preview Review handoff' })).toHaveAttribute('aria-pressed', 'true');
  await expect(proposed.getByRole('button', { name: 'Play story' })).toBeVisible();
  await expect(proposed.locator(hidden)).toHaveAttribute('aria-hidden', 'true');
  await expect(proposed.locator(shown)).toHaveAttribute('aria-hidden', 'false');
  await page.screenshot({ path: info.outputPath('saved-scene-edit-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('saved-scene-edit-mobile.png') });
  await editor.getByRole('button', { name: 'Apply scene edit' }).click();
  await expect(editor.getByRole('button', { name: /^2\. Review handoff/ })).toBeFocused();
  await expect(editor.getByRole('status')).toHaveText('Scene updated.');
  await editor.getByRole('button', { name: 'Close dialog' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const edited = JSON.parse(await download(page, live, 'Download v3 project'));
  const [manual, generated, other] = saved.storyboard.scenes;
  expect(edited).toEqual({
    ...saved, revision: saved.revision + 1, updatedAt: edited.updatedAt,
    storyboard: { ...saved.storyboard, scenes: [manual, {
      ...generated, title: 'Review handoff', duration: 8, transition: 0.65, easing: 'ease-out',
      reveal: 'sequence', camera: { ...generated.camera, padding: 12 },
    }, other] },
  });

  const html = await download(page, live, 'Download HTML presentation');
  const offline = await browser.newContext({ offline: true, reducedMotion: 'reduce' });
  try {
    const presentation = await offline.newPage();
    await presentation.setContent(html);
    await expect(presentation.getByLabel('Choose scene', { exact: true })).toContainText('Review handoff');
    await presentation.getByLabel('Choose scene', { exact: true }).selectOption('1');
    await expect(presentation.locator(hidden)).toHaveAttribute('aria-hidden', 'true');
    await expect(presentation.locator(shown)).toHaveAttribute('aria-hidden', 'false');
    await expect(presentation.locator(ancestor)).toHaveAttribute('aria-hidden', 'false');
  } finally { await offline.close(); }

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const beforeEdit = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(beforeEdit.storyboard).toEqual(saved.storyboard);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(restored.storyboard).toEqual(original.storyboard);
});

test('follows explicitly chosen connections to a loop and keeps unrelated group content hidden', async ({ page }) => {
  const source = 'flowchart LR\n subgraph Outer [Outer group]\n   subgraph Inner [Inner group]\n     A[Start]\n     B[Review]\n     X[Unselected sibling]\n   end\n end\n C[Finish]\n A send@-->|"Send"| B\n B finish@-->|"Finish"| C\n C repeat@-->|"Revisit"| A\n';
  const project = { ...createDocument(), title: 'Path story example', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Path story example' }).click();
  const live = page.getByRole('dialog', { name: 'Path story example' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Path story example' })).toBeVisible();
  const original = JSON.parse(await download(page, live, 'Download v3 project'));
  const bindings = new Map(original.identity.elements.map((record: { binding: { sourceId: string }; id: string }) => [record.binding.sourceId, record.id]));
  await live.getByRole('button', { name: 'Suggest scenes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest scenes' });
  await dialog.getByLabel('Scene strategy').selectOption('path');
  await dialog.getByLabel('Start node').selectOption({ label: 'Start (A)' });
  for (const [node, connection] of [['Start', 'Start → Review · Send · Along the arrow · send'], ['Review', 'Review → Finish · Finish · Along the arrow · finish'],
    ['Finish', 'Finish → Start · Revisit · Along the arrow · repeat']]) {
    await dialog.getByLabel(`Next connection from ${node}`).selectOption({ label: connection });
    await dialog.getByRole('button', { name: 'Add connection to path' }).click();
  }
  await expect(dialog.getByRole('status')).toContainText('Loop returns to Start. The path ends here.');
  await expect(dialog.getByRole('button', { name: 'Add connection to path' })).toHaveCount(0);
  await dialog.getByRole('checkbox', { name: 'Animate visible directional connections' }).check();
  await dialog.getByRole('button', { name: 'Preview 1 scene' }).click();
  const coverage = dialog.getByRole('list', { name: 'Suggested scene coverage' });
  await expect(coverage).toContainText('Loop returns to Start');
  await expect(coverage).toContainText('3 nodes, 3 connections, and 2 groups shown.');
  await expect(dialog.locator(`[data-element-key="${bindings.get('X')}"]`)).toHaveAttribute('aria-hidden', 'true');
  await expect(dialog.locator(`[data-element-key="${bindings.get('Inner')}"]`)).toHaveAttribute('aria-hidden', 'false');
  await dialog.getByRole('button', { name: 'Append suggested scenes' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const saved = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(saved.source).toBe(source);
  expect(saved.storyboard.scenes).toHaveLength(original.storyboard.scenes.length + 1);
  expect(saved.storyboard.scenes.at(-1)).toMatchObject({
    title: 'Loop returns to Start', flow: [bindings.get('send'), bindings.get('finish'), bindings.get('repeat')],
  });
});

test('moves saved scenes by keyboard, reviews deletion, and restores the exact scenes with Undo', async ({ page, browser }) => {
  const source = 'flowchart LR\n A[Start]\n B[Finish]\n A route@--> B\n';
  const scenes = [{ ...createScene(), title: 'First scene' }, { ...createScene(), title: 'Second scene' }];
  const project = { ...createDocument(), title: 'Saved scene order', source, storyboard: { version: 1 as const, scenes, loop: true } };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Saved scene order' }).click();
  const live = page.getByRole('dialog', { name: 'Saved scene order' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Saved scene order' })).toBeVisible();
  const original = JSON.parse(await download(page, live, 'Download v3 project'));
  const edit = live.getByRole('button', { name: 'Edit saved scenes' });
  const dialog = page.getByRole('dialog', { name: 'Edit saved scenes' });
  const dismiss = () => dialog.getByRole('button', { name: 'Close dialog' }).click();
  await edit.click();
  await expect(dialog.getByRole('button', { name: 'Move earlier' })).toBeDisabled();
  await dialog.getByRole('button', { name: /^2\. Second scene/ }).click();
  await dialog.getByRole('textbox', { name: 'Scene title' }).fill('Unapplied title');
  await dialog.getByRole('button', { name: 'Move earlier' }).press('Enter');
  await expect(dialog.getByRole('status')).toHaveText('Scene moved to position 1 of 2.');
  await expect(dialog.getByRole('button', { name: /^1\. Second scene/ })).toBeFocused();
  await expect(dialog.getByRole('textbox', { name: 'Scene title' })).toHaveValue('Unapplied title');
  await dismiss();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const ordered = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(ordered).toEqual({ ...original, revision: original.revision + 1, updatedAt: ordered.updatedAt,
    storyboard: { ...original.storyboard, scenes: [...original.storyboard.scenes].reverse() } });
  const html = await download(page, live, 'Download HTML presentation');
  const context = await browser.newContext({ offline: true, reducedMotion: 'reduce' });
  try {
    const offline = await context.newPage();
    await offline.setContent(html);
    await expect(offline.getByLabel('Choose scene', { exact: true }).getByRole('option')).toHaveText(['1. Second scene', '2. First scene']);
  } finally { await context.close(); }

  await page.setViewportSize({ width: 390, height: 844 });
  await edit.click();
  const remove = dialog.getByRole('button', { name: 'Delete scene', exact: true });
  const confirm = dialog.getByRole('button', { name: 'Delete selected scene' });
  await remove.click();
  await expect(dialog.getByText('Delete “Second scene” from this storyboard?')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Keep scene' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Keep scene' }).click();
  await expect(dialog.getByRole('button', { name: /^1\. Second scene/ })).toBeFocused();
  await remove.click();
  await confirm.click();
  await expect(dialog.getByRole('button', { name: /^1\. First scene/ })).toBeFocused();
  await remove.click();
  await confirm.click();
  await expect(dialog.getByText('No saved scenes.')).toBeFocused();
  await dismiss();
  await expect(live.getByRole('button', { name: 'Suggest scenes' })).toBeFocused();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect(JSON.parse(await download(page, live, 'Download v3 project')).storyboard.scenes).toEqual([]);
  const undo = live.getByRole('button', { name: 'Undo', exact: true });
  await undo.click();
  await undo.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect(JSON.parse(await download(page, live, 'Download v3 project')).storyboard).toEqual(ordered.storyboard);
  await undo.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect(JSON.parse(await download(page, live, 'Download v3 project')).storyboard).toEqual(original.storyboard);
});

test('authors the first overview scene by hand and appends a second reviewed scene', async ({ page, browser }, info) => {
  const source = 'flowchart LR\n A[Start]\n B[Finish]\n A route@--> B\n';
  const project = { ...createDocument(), title: 'Manual overview story', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Manual overview story' }).click();
  const live = page.getByRole('dialog', { name: 'Manual overview story' });
  const before = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(before.storyboard.scenes).toEqual([]);
  await live.getByRole('button', { name: 'Create overview scene' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit saved scenes' });
  const title = dialog.getByRole('textbox', { name: 'Scene title' });
  await expect(title).toBeFocused();
  await title.fill('Discarded scene');
  await dialog.getByRole('button', { name: 'Cancel new scene' }).click();
  await expect(dialog.getByText('No saved scenes.')).toBeVisible();
  const newScene = dialog.getByRole('button', { name: 'New overview scene' });
  await expect(newScene).toBeFocused();
  await newScene.press('Enter');
  await expect(title).toHaveValue('Scene 1');
  await title.fill('Explain the workflow');
  await dialog.getByRole('spinbutton', { name: 'Duration in seconds' }).fill('7');
  const add = dialog.getByRole('button', { name: 'Add reviewed scene' });
  const preview = dialog.getByRole('button', { name: 'Preview new scene' });
  await expect(add).toBeDisabled();
  await preview.click();
  await expect(dialog.getByRole('button', { name: 'Preview Explain the workflow' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: 'Play story' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('manual-story-scene-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('manual-story-scene-mobile.png') });
  await add.click();
  await expect(dialog.getByRole('button', { name: /^1\. Explain the workflow/ })).toBeFocused();
  await newScene.click();
  await expect(title).toHaveValue('Scene 2');
  await title.fill('Wrap up');
  await preview.click();
  await add.click();
  await expect(dialog.getByRole('button', { name: /^2\. Wrap up/ })).toBeFocused();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(after.source).toBe(source);
  expect(after.identity).toEqual(before.identity);
  expect(after.storyboard.scenes).toMatchObject([{ title: 'Explain the workflow', duration: 7, visible: null },
    { title: 'Wrap up', duration: 5, visible: null }]);
  const html = await download(page, live, 'Download HTML presentation');
  const context = await browser.newContext({ offline: true, reducedMotion: 'reduce' });
  try {
    const offline = await context.newPage();
    await offline.setContent(html);
    await expect(offline.getByLabel('Choose scene').getByRole('option')).toHaveText(['1. Explain the workflow', '2. Wrap up']);
  } finally { await context.close(); }
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect(JSON.parse(await download(page, live, 'Download v3 project')).storyboard.scenes).toEqual(after.storyboard.scenes.slice(0, 1));
});

test('resumes a local path draft after reload and reviews it against the newer project revision', async ({ page }) => {
  const source = 'flowchart LR\nA[Start]\nB[Review]\nC[Archive]\nA review@-->|"Send"| B\nB archive@--> C\n';
  const project = { ...createDocument(), title: 'Story draft example', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  async function openProjects() {
    await page.getByRole('button', { name: 'Manage projects' }).click();
    await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  }
  await page.goto('/');
  await openProjects();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Story draft example' }).click();
  const live = page.getByRole('dialog', { name: 'Story draft example' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Story draft example' })).toBeVisible();
  const original = JSON.parse(await download(page, live, 'Download v3 project'));
  await live.getByRole('button', { name: 'Suggest scenes', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Suggest scenes' });
  await dialog.getByLabel('Scene strategy').selectOption('path');
  await dialog.getByLabel('Start node').selectOption({ label: 'Start (A)' });
  await dialog.getByLabel('Next connection from Start').selectOption({ label: 'Start → Review · Send · Along the arrow · review' });
  await dialog.getByRole('button', { name: 'Add connection to path' }).click();
  await dialog.getByLabel('Scene title').fill('Reviewed path');
  await dialog.getByLabel('Scene duration in seconds').fill('7');
  await dialog.getByRole('checkbox', { name: 'Include one-hop context' }).check();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toHaveCount(0);
  await live.getByRole('button', { name: 'Edit heading', exact: true }).click();
  const heading = page.getByRole('dialog', { name: 'Edit heading' });
  await heading.getByRole('textbox', { name: 'Title', exact: true }).fill('Updated story project');
  await heading.getByRole('button', { name: 'Apply heading', exact: true }).click();
  const updated = page.getByRole('dialog', { name: 'Updated story project' });
  await expect(updated.getByText('Saved in this browser.')).toBeVisible();
  await page.reload();
  await openProjects();
  await page.getByRole('button', { name: 'Open v3 project Updated story project' }).click();
  await expect(updated.getByRole('img', { name: 'Diagram preview for Updated story project' })).toBeVisible();
  expect(JSON.parse(await download(page, updated, 'Download v3 project')).storyboard).toEqual(original.storyboard);
  await updated.getByRole('button', { name: 'Suggest scenes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Resume path story draft' }).click();
  await expect(dialog.getByText(/This draft is from an earlier revision/)).toBeVisible();
  await expect(dialog.getByLabel('Scene title')).toHaveValue('Reviewed path');
  await expect(dialog.getByLabel('Scene duration in seconds')).toHaveValue('7');
  await expect(dialog.getByRole('checkbox', { name: 'Include one-hop context' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Preview 1 scene' }).click();
  await expect(dialog.getByRole('list', { name: 'Suggested scene coverage' })).toContainText('Reviewed path');
  await dialog.getByRole('button', { name: 'Append suggested scenes' }).click();
  await expect(updated.getByText('Saved in this browser.')).toBeVisible();
  const saved = JSON.parse(await download(page, updated, 'Download v3 project'));
  expect(saved.storyboard.scenes.at(-1)).toMatchObject({ title: 'Reviewed path', duration: 7 });
  await updated.getByRole('button', { name: 'Suggest scenes', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Resume path story draft' })).toHaveCount(0);
});

test('opens a separate story copy and preserves the original project byte for byte', async ({ page }) => {
  const existing = { ...createScene(), title: 'Manual original scene' };
  const project = {
    ...createDocument(), title: 'Original diagram', source: 'flowchart LR\n A[First] --> B[Second]\n',
    storyboard: { version: 1 as const, scenes: [existing], loop: false },
  };
  await page.addInitScript(({ key, project }) => localStorage.setItem(
    key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }),
  ), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Original diagram', exact: true }).click();
  const original = page.getByRole('dialog', { name: 'Original diagram', exact: true });
  await expect(original.getByRole('img', { name: 'Diagram preview for Original diagram' })).toBeVisible();
  const before = await download(page, original, 'Download v3 project');

  await original.getByRole('button', { name: 'Suggest scenes' }).click();
  const story = page.getByRole('dialog', { name: 'Suggest scenes' });
  await story.getByLabel('Apply to storyboard').selectOption('duplicate');
  await story.getByRole('button', { name: 'Save story draft' }).click();
  await expect(story.getByRole('status')).toContainText('Story choices saved');
  await story.getByRole('button', { name: 'Close dialog' }).click();
  await original.getByRole('button', { name: 'Suggest scenes' }).click();
  await story.getByRole('button', { name: 'Resume group story draft' }).click();
  await expect(story.getByLabel('Apply to storyboard')).toHaveValue('duplicate');
  await story.getByRole('button', { name: 'Preview 1 scene' }).click();
  await expect(story.getByRole('list', { name: 'Suggested scene coverage' })).toBeVisible();
  await story.getByRole('button', { name: 'Save and open story copy' }).click();

  const copy = page.getByRole('dialog', { name: 'Original diagram — story copy' });
  await expect(copy.getByRole('img', { name: 'Diagram preview for Original diagram — story copy' })).toBeVisible();
  await expect(copy.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
  const { storyboard, ...copied } = JSON.parse(await download(page, copy, 'Download v3 project'));
  const { storyboard: originalStoryboard, ...originalProject } = JSON.parse(before);
  expect(copied.id).not.toBe(originalProject.id);
  expect(copied).toEqual({
    ...originalProject, id: copied.id, revision: 0, updatedAt: copied.updatedAt, title: 'Original diagram — story copy',
  });
  expect(storyboard.scenes).toHaveLength(1);
  expect(storyboard.scenes[0].id).not.toBe(originalStoryboard.scenes[0].id);
  await copy.getByRole('button', { name: 'Back to v3 projects' }).click();
  await page.getByRole('button', { name: 'Open v3 project Original diagram', exact: true }).click();
  await expect(original.getByRole('img', { name: 'Diagram preview for Original diagram' })).toBeVisible();
  expect(await download(page, original, 'Download v3 project')).toBe(before);
});

test('creates an explicit branch scene, reorders the paths, and resumes them after reload', async ({ page }, info) => {
  const source = 'flowchart LR\n A[Start]\n B[Main]\n C[Alternate]\n X[Unrelated]\n A main@-->|"Main"| B\n A alternate@-->|"Branch"| C\n';
  const project = { ...createDocument(), title: 'Branch story', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(
    key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }),
  ), { key: STORAGE_KEY, project });
  async function openProject(migrate = false) {
    await page.getByRole('button', { name: 'Manage projects' }).click();
    await page.getByRole('button', { name: 'Project migration and recovery' }).click();
    if (migrate) await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await page.getByRole('button', { name: 'Open v3 project Branch story' }).click();
    const live = page.getByRole('dialog', { name: 'Branch story' });
    await expect(live.getByRole('img', { name: 'Diagram preview for Branch story' })).toBeVisible();
    return live;
  }
  await page.goto('/');
  const live = await openProject(true);
  const original = JSON.parse(await download(page, live, 'Download v3 project'));
  const bindings = new Map(original.identity.elements.map((record: { binding: { sourceId: string }; id: string }) => [record.binding.sourceId, record.id]));
  const dialog = page.getByRole('dialog', { name: 'Suggest scenes' });
  await live.getByRole('button', { name: 'Suggest scenes', exact: true }).click();
  await dialog.getByLabel('Scene strategy').selectOption('path');
  await dialog.getByLabel('Start node').selectOption({ label: 'Start (A)' });
  await dialog.getByLabel('Next connection from Start').selectOption({ label: 'Start → Main · Main · Along the arrow · main' });
  await dialog.getByRole('button', { name: 'Add connection to path' }).click();
  await dialog.getByLabel('Scene title').fill('Reviewed main');
  await dialog.getByRole('combobox', { name: 'Branch starts at' }).selectOption({ label: 'Start (A)' });
  await dialog.getByRole('button', { name: 'Add branch scene' }).click();
  await dialog.getByLabel('Next connection from Start').selectOption({ label: 'Start → Alternate · Branch · Along the arrow · alternate' });
  await dialog.getByRole('button', { name: 'Add connection to path' }).click();
  await dialog.getByLabel('Scene title').fill('Reviewed branch');
  await dialog.getByRole('button', { name: 'Move path scene 2 earlier' }).click();
  await dialog.getByRole('button', { name: 'Save story draft' }).click();
  await expect(dialog.getByRole('status')).toContainText('Story choices saved');
  await page.reload();
  await openProject();
  await live.getByRole('button', { name: 'Suggest scenes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Resume path story draft' }).click();
  const order = dialog.getByRole('list', { name: 'Path scene order' });
  await expect(order.getByRole('listitem').first()).toContainText('Reviewed branch');
  await expect(order.getByRole('listitem').last()).toContainText('Reviewed main');
  await dialog.getByRole('button', { name: 'Preview 2 scenes' }).click();
  const coverage = dialog.getByRole('list', { name: 'Suggested scene coverage' });
  await expect(coverage.getByRole('listitem').first()).toContainText('2 nodes, 1 connection, and 0 groups shown.');
  await expect(coverage.getByRole('listitem').first()).toContainText('Reviewed branch');
  await expect(dialog.locator(`[data-element-key="${bindings.get('X')}"]`)).toHaveAttribute('aria-hidden', 'true');
  await page.screenshot({ path: info.outputPath('branch-scene-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('branch-scene-mobile.png') });
  await dialog.getByRole('button', { name: 'Append suggested scenes' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const saved = JSON.parse(await download(page, live, 'Download v3 project'));
  expect(saved.storyboard.scenes.map((item: { title: string }) => item.title)).toEqual(['Reviewed branch', 'Reviewed main']);
  expect(new Set(saved.storyboard.scenes[0].visible)).toEqual(new Set([bindings.get('A'), bindings.get('C'), bindings.get('alternate')]));
  expect(new Set(saved.storyboard.scenes[1].visible)).toEqual(new Set([bindings.get('A'), bindings.get('B'), bindings.get('main')]));
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect(JSON.parse(await download(page, live, 'Download v3 project')).storyboard).toEqual(original.storyboard);
});
