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
  await page.getByRole('button', { name: 'Authoring tools', exact: true }).click();
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
  await report.getByText('Measurement coverage', { exact: true }).click();
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

test('reviews scoped paint inside nested groups and preserves other elements and source bytes', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  subgraph Fleet [Fleet]\r\n    subgraph Team [Team]\r\n'
    + '      A[Client]\r\n      B[Service]\r\n    end\r\n    C[Warehouse]\r\n  end\r\n'
    + '  A route@--> B\r\n  B delivery@--> C\r\n  linkStyle 1 stroke:#446677\r\n';
  const project = { ...createDocument(), title: 'Nested scoped recipe', source };
  project.design.elements['node:A'] = { fill: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Nested scoped recipe' }).click();
  const live = page.getByRole('dialog', { name: 'Nested scoped recipe' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Nested scoped recipe' })).toBeVisible();
  const before = await downloadProject(page, live);
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
  await design.getByRole('group', { name: 'Design recipes' }).getByRole('button', { name: /Technical/ }).click();
  await design.getByRole('button', { name: 'Preview Technical' }).click();
  await expect(design.getByRole('region', { name: 'Reviewed design scope' })).toContainText('Applies to 2 of 2 elements. 1 protected paint field.');
  await design.getByRole('button', { name: 'Apply Technical' }).click();
  const after = await downloadProject(page, live);
  const client = before.identity.elements.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'A').id;
  const service = before.identity.elements.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'B').id;
  const recipe = { id: 'technical', version: '1.0.0' };
  expect(after).toEqual({
    ...before, revision: before.revision + 1, updatedAt: after.updatedAt,
    design: { ...before.design, recipeElements: {
      [client]: { recipe, style: { color: '#e0f2fe', stroke: '#38bdf8' } },
      [service]: { recipe, style: { fill: '#13212d', color: '#e0f2fe', stroke: '#38bdf8' } },
    } },
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = await downloadProject(page, live);
  expect(undone).toEqual({ ...before, revision: after.revision + 1, updatedAt: undone.updatedAt });
});

test('reviews a verified Decision diamond while preserving authored source and explicit shape overrides', async ({ page, browser }, info) => {
  const base = JSON.parse(await readFile(new URL('../../src/lib/authoring/fixtures/example-project.json', import.meta.url), 'utf8'));
  const source = '\uFEFF' + base.source.replace(/\n/g, '\r\n');
  const [decision, manual] = base.identity.elements;
  const project = {
    ...base, source, title: 'Reviewed Decision shapes',
    design: { ...base.design, elements: { [manual.id]: { shape: 'circle' } } },
    roles: [{ elementId: decision.id, role: 'decision' }, { elementId: manual.id, role: 'decision' }],
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  const library = page.getByRole('dialog', { name: 'Project migration and recovery' });
  await library.getByLabel('Import v3 project file').setInputFiles({
    name: 'decisions.meridian.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  });
  await library.getByRole('button', { name: 'Open v3 project Reviewed Decision shapes' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  const before = await downloadProject(page, live);
  await live.getByRole('button', { name: 'Explore designs' }).click();
  const review = page.getByRole('dialog', { name: 'Explore designs' });
  await review.getByRole('group', { name: 'Design recipes' }).getByRole('button', { name: /^Presentation/ }).click();
  const useShapes = review.getByRole('checkbox', { name: 'Use diamonds for Decision nodes' });
  await expect(useShapes).not.toBeChecked();
  await useShapes.check();
  await expect(review.getByText(/Mermaid source keeps its original notation/)).toBeVisible();
  await review.getByRole('button', { name: 'Preview Presentation' }).click();
  const changes = review.getByRole('list', { name: 'Design changes' });
  await expect(changes).toContainText('Client · Presentation shape · Existing shape → Diamond');
  await expect(changes).not.toContainText('API · Presentation shape');
  await review.getByRole('img', { name: 'Proposed Presentation design' }).waitFor();
  await page.screenshot({ path: info.outputPath('presentation-decision-shape-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('presentation-decision-shape-mobile.png') });
  await review.getByRole('button', { name: 'Apply Presentation' }).click();
  const after = await downloadProject(page, live);
  expect(after).toMatchObject({ source, identity: before.identity, roles: before.roles,
    design: { elements: before.design.elements, recipe: { id: 'presentation', version: '1.0.0' }, applyRoleShapes: true } });

  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download HTML presentation' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing presentation download.');
  const offline = await browser.newContext({ offline: true });
  try {
    const exported = await offline.newPage();
    await exported.setContent(await readFile(path, 'utf8'));
    await expect(exported.locator(`[data-element-key="${decision.id}"] polygon`)).toBeVisible();
    await expect(exported.locator(`[data-element-key="${manual.id}"] circle`)).toBeVisible();
  } finally {
    await offline.close();
  }
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  const restored = await downloadProject(page, live);
  expect(restored).toEqual({ ...before, revision: after.revision + 1, updatedAt: restored.updatedAt });
});

test('reviews larger selected labels and discloses measured movement outside the selection', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  A[Long intake label for a wider node]\r\n  B[Downstream]\r\n'
    + '  C[Manual font]\r\n  D[User font]\r\n  A first@--> B\r\n  B second@--> C\r\n  C third@--> D\r\n';
  const project = { ...createDocument(), title: 'Reviewed typography', source };
  project.settings = { ...project.settings, layout: 'dagre', motion: 'none' };
  project.design.elements['node:C'] = { fontSize: 17 };
  project.design.elements['node:D'] = { fontSize: 19 };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Reviewed typography' }).click();
  const live = page.getByRole('dialog', { name: 'Reviewed typography' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Reviewed typography' })).toBeVisible();
  const original = await downloadProject(page, live);

  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Long intake label/ }).click();
  await outline.getByRole('treeitem', { name: /^Manual font/ }).click({ modifiers: ['Shift'] });
  await outline.getByRole('treeitem', { name: /^User font/ }).click({ modifiers: ['Shift'] });
  await expect(outline.getByRole('status')).toHaveText('3 selected · 0 hidden');
  await outline.getByRole('button', { name: 'Explore designs for selection' }).click();
  const design = page.getByRole('dialog', { name: 'Explore designs' });
  await design.getByRole('group', { name: 'Design recipes' }).getByRole('button', { name: /Presentation/ }).click();
  const typography = design.getByRole('checkbox', { name: 'Enlarge eligible node labels' });
  await expect(typography).not.toBeChecked();
  await typography.check();
  await design.getByRole('button', { name: 'Preview Presentation' }).click();
  const error = design.getByRole('alert');
  await expect(error.or(design.getByRole('img', { name: 'Proposed Presentation design' }))).toBeVisible();
  expect(await error.allTextContents()).toEqual([]);
  const apply = design.getByRole('button', { name: 'Apply Presentation', exact: true });
  await expect(apply).toBeEnabled();
  const change = design.getByRole('list', { name: 'Design changes' });
  await expect(change.getByText(/Long intake label for a wider node.*Label size · [\d.]+ px → 22 px/)).toBeVisible();
  await expect(change.getByText(/Manual font.*Label size|User font.*Label size|Downstream/)).toHaveCount(0);
  const scope = design.getByRole('region', { name: 'Reviewed design scope' });
  await expect(scope.getByText('Automatic layout moved 1 node outside this scope. Style changes apply only to the reviewed targets.')).toBeVisible();
  await scope.getByText('Review moved nodes', { exact: true }).click();
  await expect(scope.getByText('Downstream (B)', { exact: true })).toBeVisible();
  await scope.getByText('Review preserved font sizes', { exact: true }).click();
  await expect(scope.getByText('Manual font (C)', { exact: true })).toBeVisible();
  await expect(scope.getByText('User font (D)', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('reviewed-typography-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('reviewed-typography-mobile.png') });
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const edited = await downloadProject(page, live);
  const ids = new Map(original.identity.elements.map((item: { id: string; binding: { sourceId: string } }) =>
    [item.binding.sourceId, item.id] as const));
  expect(edited.design.recipeElements[ids.get('A')!].style.fontSize).toBe(22);
  expect(edited.design.recipeElements[ids.get('B')!]).toBeUndefined();
  expect(edited.design.recipeElements[ids.get('C')!].style.fontSize).toBeUndefined();
  expect(edited.design.recipeElements[ids.get('D')!].style.fontSize).toBeUndefined();
  expect(edited.design.elements).toEqual(original.design.elements);
  expect(edited.settings).toEqual(original.settings);
  expect(edited.source).toBe(source);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = await downloadProject(page, live);
  expect(undone).toEqual({ ...original, revision: edited.revision + 1, updatedAt: undone.updatedAt });
});

test('preserves a successful design candidate when a different option fails', async ({ page }) => {
  const source = 'flowchart LR\n  A[Client]\n  B[Service]\n  A route@--> B\n';
  const project = { ...createDocument(), title: 'Independent design candidates', source };
  await page.addInitScript(({ key, project }) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }));
    const parse = DOMParser.prototype.parseFromString;
    let failNextSvg = false;
    window.addEventListener('test-design-option-failure', () => { failNextSvg = true; });
    DOMParser.prototype.parseFromString = function(text, type) {
      if (failNextSvg && type === 'image/svg+xml') {
        failNextSvg = false;
        document.documentElement.dataset.designFault = 'used';
        return parse.call(this, '<malformed', type);
      }
      return parse.call(this, text, type);
    };
  }, { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Independent design candidates' }).click();
  const live = page.getByRole('dialog', { name: project.title, exact: true });
  await expect(live.getByRole('img', { name: /Diagram preview for/ })).toBeVisible();
  const original = await downloadProject(page, live);
  await live.getByRole('button', { name: 'Explore designs', exact: true }).click();
  const design = page.getByRole('dialog', { name: 'Explore designs' });
  const choices = design.getByRole('group', { name: 'Design recipes' });

  await design.getByRole('button', { name: 'Preview Clear' }).click();
  const clear = choices.getByRole('button', { name: /^Clear/ });
  const apply = design.getByRole('button', { name: 'Apply Clear', exact: true });
  const image = design.getByRole('img', { name: 'Proposed Clear design' });
  await expect(apply).toBeEnabled();
  const url = await image.getAttribute('src');
  expect(url).toBeTruthy();
  await expect(clear).toContainText('Preview ready');
  const presentation = choices.getByRole('button', { name: /^Presentation/ });
  await presentation.click();
  await design.getByRole('button', { name: 'Preview Presentation' }).focus();
  await page.evaluate(() => window.dispatchEvent(new Event('test-design-option-failure')));
  await design.getByRole('button', { name: 'Preview Presentation' }).press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-design-fault', 'used');
  await expect(design.getByRole('alert')).toBeVisible();
  await expect(presentation).toContainText('Preview failed');
  await expect(clear).toContainText('Preview ready');
  await expect(design.getByRole('button', { name: 'Apply Presentation', exact: true })).toBeDisabled();

  await clear.focus();
  await clear.press('Enter');
  await expect(design.getByRole('alert')).toHaveCount(0);
  await expect(presentation).toContainText('Preview failed');
  await expect(image).toHaveAttribute('src', url!);
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const accepted = await downloadProject(page, live);
  expect(accepted.source).toBe(source);
  expect(accepted.design.recipe).toEqual({ id: 'clear', version: '1.0.0' });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = await downloadProject(page, live);
  expect(undone).toEqual({ ...original, revision: accepted.revision + 1, updatedAt: undone.updatedAt });
});

test('applies a reviewed Decision diamond only within the selected recipe scope', async ({ page, browser }) => {
  const base = JSON.parse(await readFile(new URL('../../src/lib/authoring/fixtures/example-project.json', import.meta.url), 'utf8'));
  const [decision, manual] = base.identity.elements;
  const outside = { ...decision, id: crypto.randomUUID(), binding: { type: 'source-id', sourceId: 'C' } };
  const source = '\uFEFF' + (base.source + '  C["Outside decision"]\n').replace(/\n/g, '\r\n');
  const project = {
    ...base, source, title: 'Selected Decision shapes',
    identity: { ...base.identity, elements: [...base.identity.elements, outside] },
    design: { ...base.design, elements: { [manual.id]: { shape: 'circle' } } },
    roles: [decision, manual, outside].map(item => ({ elementId: item.id, role: 'decision' })),
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  const library = page.getByRole('dialog', { name: 'Project migration and recovery' });
  await library.getByLabel('Import v3 project file').setInputFiles({
    name: 'selected-shapes.meridian.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  });
  await library.getByRole('button', { name: 'Open v3 project Selected Decision shapes' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  await expect(live.getByRole('img', { name: /Diagram preview for/ })).toBeVisible();
  const before = await downloadProject(page, live);
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Client/ }).click();
  await outline.getByRole('treeitem', { name: /^API/ }).click({ modifiers: ['Shift'] });
  await outline.getByRole('button', { name: 'Explore designs for selection' }).click();

  const review = page.getByRole('dialog', { name: 'Explore designs' });
  await expect(review.getByRole('combobox', { name: 'Design scope' })).toHaveValue('selection');
  await review.getByRole('group', { name: 'Design recipes' }).getByRole('button', { name: /^Presentation/ }).click();
  const useShapes = review.getByRole('checkbox', { name: 'Use diamonds for Decision nodes' });
  await expect(useShapes).not.toBeChecked();
  await useShapes.check();
  await review.getByRole('button', { name: 'Preview Presentation' }).click();
  const changes = review.getByRole('list', { name: 'Design changes' });
  await expect(changes).toContainText('Client (A) · Presentation shape · Existing shape → Diamond');
  await expect(changes).not.toContainText('Outside decision');
  const scope = review.getByRole('region', { name: 'Reviewed design scope' });
  await scope.getByText('Review preserved shapes').click();
  await expect(scope.getByText('API (B)', { exact: true })).toBeVisible();
  await review.getByRole('button', { name: 'Apply Presentation' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const accepted = await downloadProject(page, live);
  expect(accepted.source).toBe(source);
  expect(accepted.settings).toEqual(before.settings);
  expect(accepted.design.recipe).toEqual(before.design.recipe);
  expect(accepted.design.applyRoleShapes).toBe(false);
  expect(accepted.design.recipeElements[decision.id]).toMatchObject({ recipe: { id: 'presentation', version: '1.0.0' }, style: { shape: 'diamond' } });
  expect(accepted.design.elements[manual.id].shape).toBe('circle');
  expect(accepted.design.recipeElements[manual.id].style.shape).toBeUndefined();
  expect(accepted.design.recipeElements[outside.id]).toBeUndefined();

  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download HTML presentation' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing scoped presentation download.');
  const offline = await browser.newContext({ offline: true });
  try {
    const presentation = await offline.newPage();
    await presentation.setContent(await readFile(path, 'utf8'));
    await expect(presentation.locator(`[data-element-key="${decision.id}"] polygon`)).toBeVisible();
    await expect(presentation.locator(`[data-element-key="${manual.id}"] circle`)).toBeVisible();
    const untouched = presentation.locator(`[data-element-key="${outside.id}"]`);
    await expect(untouched).toContainText('Outside decision');
    await expect(untouched.locator('polygon')).toHaveCount(0);
  } finally { await offline.close(); }

  await live.getByRole('button', { name: 'Export diagram', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Take your diagram with you.' });
  await exportDialog.getByRole('button', { name: /Mermaid/ }).click();
  const [sourceFile] = await Promise.all([
    page.waitForEvent('download'), exportDialog.getByRole('button', { name: 'Download MERMAID', exact: true }).click(),
  ]);
  const sourcePath = await sourceFile.path();
  if (!sourcePath) throw new Error('Missing Mermaid source download.');
  expect(await readFile(sourcePath, 'utf8')).toBe(source);
  await exportDialog.getByRole('button', { name: 'Close dialog' }).click();

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored).toEqual({ ...before, revision: accepted.revision + 1, updatedAt: restored.updatedAt });
});
