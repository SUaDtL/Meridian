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

test('reviews a filtered selection recipe and keeps protected overrides and global settings', async ({ page }, info) => {
  const source = 'flowchart LR\n A[Client]\n B[Service]\n C[Warehouse]\n A route@--> B\n';
  const project = { ...createDocument(), title: 'Scoped recipe', source };
  project.design.elements['node:A'] = { fill: '#abcdef', strokeWidth: 3 };
  project.design.elements['node:C'] = { fill: '#123456' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Scoped recipe' }).click();
  const live = page.getByRole('dialog', { name: 'Scoped recipe' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Scoped recipe' })).toBeVisible();
  const before = await downloadProject(page, live);
  const ids = new Map(before.identity.elements.map((item: { binding: { sourceId: string }; id: string }) => [item.binding.sourceId, item.id]));
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Client/ }).click();
  await outline.getByRole('treeitem', { name: /^Service/ }).click({ modifiers: ['Shift'] });
  await outline.getByRole('textbox', { name: 'Find an element' }).fill('Client');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await outline.getByRole('button', { name: 'Explore designs for selection' }).click();
  const design = page.getByRole('dialog', { name: 'Explore designs' });
  await expect(design.getByRole('combobox', { name: 'Design scope' })).toHaveValue('selection');
  await expect(design.getByText('2 selected · 1 hidden in the outline')).toBeVisible();
  await expect(design.getByRole('checkbox', { name: 'Preserve my element overrides' })).toBeChecked();
  await design.getByRole('group', { name: 'Design recipes' }).getByRole('button', { name: /Technical/ }).click();
  await design.getByRole('button', { name: 'Preview Technical' }).click();
  await expect(design.getByRole('img', { name: 'Proposed Technical design' })).toBeVisible();
  const review = design.getByRole('region', { name: 'Reviewed design scope' });
  await expect(review).toContainText('Applies to 2 of 2 elements. 1 protected paint field.');
  await expect(review).toContainText('frame');
  await page.screenshot({ path: info.outputPath('scoped-recipe-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('scoped-recipe-mobile.png') });
  await design.getByRole('button', { name: 'Apply Technical' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = await downloadProject(page, live);
  const recipe = { id: 'technical', version: '1.0.0' };
  expect(after).toEqual({
    ...before, revision: before.revision + 1, updatedAt: after.updatedAt,
    design: { ...before.design, recipeElements: {
      [ids.get('A') as string]: { recipe, style: { color: '#e0f2fe', stroke: '#38bdf8' } },
      [ids.get('B') as string]: { recipe, style: { fill: '#13212d', color: '#e0f2fe', stroke: '#38bdf8' } },
    } },
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = await downloadProject(page, live);
  expect(undone).toEqual({ ...before, revision: after.revision + 1, updatedAt: undone.updatedAt });

  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  await outline.getByRole('button', { name: 'Explore designs for selection' }).click();
  await design.getByRole('group', { name: 'Design recipes' }).getByRole('button', { name: /Technical/ }).click();
  await design.getByRole('checkbox', { name: 'Preserve my element overrides' }).uncheck();
  await expect(design.getByRole('button', { name: 'Apply Technical' })).toBeDisabled();
  await design.getByRole('button', { name: 'Preview Technical' }).click();
  await expect(review).toContainText('Clears 1 user paint override from 1 element.');
  await expect(design.getByRole('list', { name: 'Design changes' })).toContainText('Client (A) · Fill · Clear user override · #abcdef → #13212d');
  await design.getByRole('button', { name: 'Apply Technical' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const cleared = await downloadProject(page, live);
  expect(cleared).toEqual({
    ...after, revision: undone.revision + 1, updatedAt: cleared.updatedAt,
    design: { ...after.design, elements: { ...before.design.elements, [ids.get('A') as string]: { strokeWidth: 3 } },
      recipeElements: { ...after.design.recipeElements, [ids.get('A') as string]: after.design.recipeElements[ids.get('B') as string] } },
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored).toEqual({ ...before, revision: cleared.revision + 1, updatedAt: restored.updatedAt });
});

test('applies the reviewed paint recipe only to nodes of one explicit role', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Systems and relationships' }).click();
  await page.getByRole('button', { name: 'Enter systems manually' }).click();
  const systems = page.getByRole('dialog', { name: 'Build a systems diagram' });
  await systems.getByLabel('Project title').fill('Role recipe');
  for (const [index, label, role] of [[1, 'Service instance', 'service'], [2, 'Store', 'database']] as const) {
    await systems.getByRole('button', { name: 'Add system', exact: true }).click();
    const row = systems.getByRole('group', { name: `System ${index}` });
    await row.getByRole('textbox', { name: 'Label' }).fill(label);
    await row.getByRole('combobox', { name: 'Role' }).selectOption(role);
  }
  await systems.getByRole('button', { name: 'Review relationships' }).click();
  await systems.getByRole('button', { name: 'Preview systems diagram' }).click();
  await systems.getByRole('button', { name: 'Create systems project' }).click();
  const live = page.getByRole('dialog', { name: 'Role recipe' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Role recipe' })).toBeVisible();
  const before = await downloadProject(page, live);
  const database = before.roles.find((item: { role: string }) => item.role === 'database');
  await live.getByRole('button', { name: 'Explore designs', exact: true }).click();
  const design = page.getByRole('dialog', { name: 'Explore designs' });
  await design.getByRole('combobox', { name: 'Design scope' }).selectOption('role');
  await design.getByRole('combobox', { name: 'Role', exact: true }).selectOption('database');
  await design.getByRole('button', { name: 'Preview Clear', exact: true }).click();
  await expect(design.getByRole('region', { name: 'Reviewed design scope' })).toContainText('Applies to 1 of 1 elements');
  await design.getByRole('button', { name: 'Apply Clear', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = await downloadProject(page, live);
  expect(Object.keys(after.design.recipeElements)).toEqual([database.elementId]);
  expect(after.settings).toEqual(before.settings);
  expect(after.roles).toEqual(before.roles);
  expect(after.source).toBe(before.source);

  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Store/ }).click();
  await outline.getByRole('button', { name: 'Change selected text color' }).click();
  const paint = page.getByRole('dialog', { name: 'Change selected text color' });
  await paint.getByRole('textbox', { name: 'New text color' }).fill('#334455');
  await paint.getByRole('button', { name: 'Preview text color' }).click();
  await paint.getByRole('button', { name: 'Apply to 1 eligible labels' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  await live.getByRole('button', { name: 'Check readability' }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  await check.getByRole('button', { name: 'Check diagram' }).click();
  const report = check.getByRole('region', { name: 'Readability results' });
  await expect(report.getByText('Explicit role styling · 1 measured · 0 unknown · 1 not applicable')).toBeVisible();
  await expect(report.getByText('Store has the database role. Text color renders as #334455. The saved recipe specifies #0f172a. User override #334455.')).toBeVisible();
  await report.getByRole('button', { name: 'Review reset for Store' }).click();
  const reset = page.getByRole('dialog', { name: 'Reset selected styles' });
  await expect(reset.getByRole('combobox', { name: 'Property' })).toHaveValue('color');
  await reset.getByRole('button', { name: 'Preview reset' }).click();
  await reset.getByRole('button', { name: 'Apply reset' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored.design).toEqual(after.design);
  expect(restored.source).toBe(before.source);
});

test('resets user and recipe styles separately, previews the revealed value, and restores either layer', async ({ page }) => {
  const source = 'flowchart LR\n A[Client]\n B[Service]\n A route@--> B\n';
  const project = { ...createDocument(), title: 'Style reset', source };
  project.design.elements['node:A'] = { strokeWidth: 3 };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Style reset' }).click();
  const live = page.getByRole('dialog', { name: 'Style reset' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Style reset' })).toBeVisible();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const reset = page.getByRole('dialog', { name: 'Reset selected styles' });
  const openOutline = () => live.getByRole('button', { name: 'Outline', exact: true }).click();
  const openReset = () => outline.getByRole('button', { name: 'Reset selected styles' }).click();
  await openOutline();
  await outline.getByRole('treeitem', { name: /^Client/ }).click();
  await outline.getByRole('button', { name: 'Explore designs for selection' }).click();
  const design = page.getByRole('dialog', { name: 'Explore designs' });
  await design.getByRole('button', { name: 'Preview Clear' }).click();
  await design.getByRole('button', { name: 'Apply Clear' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  await openOutline();
  await outline.getByRole('button', { name: 'Change selected text color' }).click();
  const text = page.getByRole('dialog', { name: 'Change selected text color' });
  await text.getByRole('textbox', { name: 'New text color' }).fill('#334455');
  await text.getByRole('button', { name: 'Preview text color' }).click();
  await text.getByRole('button', { name: 'Apply to 1 eligible labels' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const before = await downloadProject(page, live);
  const client = before.identity.elements.find((element: { binding: { sourceId: string } }) => element.binding.sourceId === 'A').id;
  const preview = async () => {
    await expect(reset.getByRole('button', { name: 'Apply reset' })).toBeDisabled();
    await reset.getByRole('button', { name: 'Preview reset' }).click();
    await expect(reset.getByRole('img', { name: 'Diagram preview after the selected style reset' })).toBeVisible();
    await reset.getByText('Review affected elements and inherited values').click();
  };
  await openOutline();
  await openReset();
  await reset.getByRole('radio', { name: 'Reset user override' }).check();
  await reset.getByRole('combobox', { name: 'Property' }).selectOption('color');
  await preview();
  await expect(reset.getByText(/Text color · Removed #334455 · Recipe clear 1\.0\.0 · Rendered #0f172a/i)).toBeVisible();
  await reset.getByRole('button', { name: 'Apply reset' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const userReset = await downloadProject(page, live);
  expect(userReset.design.recipeElements).toEqual(before.design.recipeElements);
  expect(userReset.design.elements[client]).toEqual({ strokeWidth: 3 });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect((await downloadProject(page, live)).design).toEqual(before.design);

  await openOutline();
  await openReset();
  await reset.getByRole('radio', { name: 'Reset selected design' }).check();
  await preview();
  await expect(reset.getByText(/Text color · Removed #0f172a · User override · Rendered #334455/i)).toBeVisible();
  await reset.getByRole('button', { name: 'Apply reset' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const recipeReset = await downloadProject(page, live);
  expect(recipeReset.design.recipeElements).toEqual({});
  expect(recipeReset.design.elements).toEqual(before.design.elements);
  expect(recipeReset.source).toBe(source);
  expect(recipeReset.identity).toEqual(before.identity);
  expect(recipeReset.settings).toEqual(before.settings);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect((await downloadProject(page, live)).design).toEqual(before.design);
});
