import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function download(page: Page, live: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing source edit project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('keeps an invalid source draft, previews binding-preserving changes, and restores the exact source with Undo', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  %% Authored comment\r\n  A[First]\r\n  B[Second]\r\n  A first@--> B\r\n';
  const project = { ...createDocument(), title: 'Reviewed source edit', source };
  project.design.elements['node:A'] = { fill: '#abcd12' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Reviewed source edit' }).click();
  const live = page.getByRole('dialog', { name: 'Reviewed source edit' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Reviewed source edit' })).toBeVisible();
  const original = await download(page, live);
  const open = () => live.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  await open();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const input = editor.getByRole('textbox', { name: 'Mermaid source' });
  const invalid = 'flowchart LR\n A["unclosed';
  await input.fill(invalid);
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await expect(editor.getByRole('alert')).toContainText('Mermaid syntax · Line 2');
  const detail = editor.getByText('Mermaid parser details', { exact: true });
  await expect(detail).toBeVisible();
  await expect(detail.locator('..')).not.toHaveAttribute('open');
  await editor.getByRole('button', { name: 'Go to line 2' }).click();
  await expect(input).toBeFocused();
  expect(await input.evaluate(() => window.getSelection()?.toString())).toBe(' A["unclosed');
  await expect(editor.getByRole('button', { name: 'Apply source' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await download(page, live)).toEqual(original);
  await open();
  await expect.poll(() => input.innerText()).toBe(invalid);
  await input.fill('flowchart LR\n A@{ img: "https://example.invalid/shape.png" }\n');
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await expect(editor.getByRole('alert')).toContainText('Resource restriction');
  await expect(editor.getByRole('button', { name: 'Apply source' })).toBeDisabled();
  await input.fill('sequenceDiagram\n Alice->>Bob: Hello\n');
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await expect(editor.getByRole('alert')).toContainText('Reviewed editing limitation');
  await expect(editor.getByRole('alert')).toContainText('Mermaid rendered this diagram.');
  const revised = source.replace('A[First]', 'A[Gateway]') + '  C[Archive]\r\n  B second@--> C\r\n';
  await input.fill(revised.replace(/\r\n/g, '\n'));
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await expect(editor.getByRole('region', { name: 'Proposed source edit' })).toContainText('3 existing bindings preserved · 2 new bindings');
  await page.screenshot({ path: info.outputPath('v3-source-preview-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('v3-source-preview-mobile.png') });
  await editor.getByRole('button', { name: 'Apply source' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const accepted = await download(page, live);
  expect(accepted.source).toBe(revised);
  expect(accepted.identity.elements).toEqual(expect.arrayContaining(original.identity.elements));
  expect(accepted.design).toEqual(original.design);
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
  await open();
  await input.fill('flowchart LR\nA[Gateway]\n');
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await expect(editor.getByRole('alert')).toContainText('would lose an existing diagram binding');
  await editor.getByRole('button', { name: 'Discard draft' }).click();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download(page, live);
  expect(restored.source).toBe(source);
  expect(restored.identity).toEqual(original.identity);
  expect(restored.design).toEqual(original.design);
});

test('preserves long and formatted labels until the author edits their Mermaid source', async ({ page }) => {
  const longLabel = 'Detailed handoff '.repeat(13).trim();
  const richLabel = '`**Review** the handoff`';
  const source = `\uFEFFflowchart LR\r\n  A["${longLabel}"]\r\n  B["${richLabel}"]\r\n  A link@--> B\r\n`;
  const project = { ...createDocument(), title: 'Preserved source labels', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Preserved source labels' }).click();
  const live = page.getByRole('dialog', { name: 'Preserved source labels' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Preserved source labels' })).toBeVisible();
  const accepted = await download(page, live);
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  for (const id of ['A', 'B']) {
    await live.getByRole('button', { name: 'Edit flowchart' }).click();
    await edit.getByRole('combobox', { name: 'Operation' }).selectOption('setNodeLabel');
    const option = await edit.getByRole('combobox', { name: 'Node to rename' }).getByRole('option', { name: new RegExp(`\\(${id}\\)$`) }).textContent();
    await edit.getByRole('combobox', { name: 'Node to rename' }).selectOption({ label: option! });
    await edit.getByRole('textbox', { name: 'Node label' }).fill('Short visual replacement');
    await edit.getByRole('button', { name: 'Preview change' }).click();
    await expect(edit.getByRole('alert')).toContainText('Use the Mermaid source editor to edit this long or formatted label.');
    await expect(edit.getByRole('button', { name: 'Apply change' })).toBeDisabled();
    await edit.getByRole('button', { name: 'Cancel' }).click();
    expect(await download(page, live)).toEqual(accepted);
  }
  await live.getByRole('button', { name: 'Edit Mermaid source' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const revised = source.replace('**Review** the handoff', '**Verify** the handoff');
  await editor.getByRole('textbox', { name: 'Mermaid source' }).fill(revised.replace(/\r\n/g, '\n'));
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await editor.getByRole('button', { name: 'Apply source' }).click();
  const applied = await download(page, live);
  expect(applied.source).toBe(revised);
  expect(applied.identity).toEqual(accepted.identity);
});

test('offers proven endpoint completion and keeps draft history separate from accepted changes', async ({ page }) => {
  const source = 'flowchart LR\n  alpha[Client]\n  beta[Worker]\n';
  const project = { ...createDocument(), title: 'Source completion', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Source completion' }).click();
  const live = page.getByRole('dialog', { name: 'Source completion' });
  await live.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const input = editor.getByRole('textbox', { name: 'Mermaid source' });
  await expect(input).toBeFocused();
  const suggestions = editor.getByRole('listbox');
  for (const blocked of ['  %% alpha ready@--> be', '  gamma["alpha ready@--> be', '  unknown ready@--> be']) {
    await input.fill(source + blocked);
    await input.press('Control+End');
    await input.press('Control+Space');
    await expect(suggestions).toHaveCount(0);
  }
  await input.fill(source + '  alpha ready@--> be');
  await input.press('Control+End');
  await input.press('Control+Space');
  await expect(suggestions.getByRole('option', { name: /beta.*Worker/ })).toBeVisible();
  await input.press('Escape');
  await expect(editor).toBeVisible();
  await expect(suggestions).toHaveCount(0);
  await input.press('Control+Space');
  await expect(suggestions.getByRole('option', { name: /beta.*Worker/ })).toBeVisible();
  await suggestions.getByRole('option', { name: /beta.*Worker/ }).click();
  await expect(input).toContainText('alpha ready@--> beta');
  await input.press('Control+z');
  await expect(input).toContainText('alpha ready@--> be');
  await expect(input).not.toContainText('alpha ready@--> beta');
  await input.press('Control+y');
  await expect(input).toContainText('alpha ready@--> beta');
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await expect(editor.getByRole('region', { name: 'Proposed source edit' })).toContainText('2 existing bindings preserved · 1 new binding');
  await editor.getByRole('button', { name: 'Apply source' }).click();
  expect((await download(page, live)).source).toBe(source + '  alpha ready@--> beta');
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await download(page, live)).source).toBe(source);
});

test('downloads and restores an over-limit annotation source draft with its exact accepted base', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  A[First]\r\n  B[Second]\r\n';
  const revised = source.replace('  B[Second]\r\n', '');
  const project = { ...createDocument(), title: 'Recover source draft', source };
  project.design.elements = Object.fromEntries(Array.from({ length: 500 },
    (_, index) => [`node:Former${index}`, { fill: '#123456' }]));
  await page.addInitScript(({ key, project }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }));
  }, { key: STORAGE_KEY, project });
  async function openProject(migrate = false) {
    await page.getByRole('button', { name: 'Manage projects' }).click();
    await page.getByRole('button', { name: 'Project migration and recovery' }).click();
    if (migrate) await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await page.getByRole('button', { name: 'Open v3 project Recover source draft' }).click();
    return page.getByRole('dialog', { name: 'Recover source draft' });
  }
  await page.goto('/');
  const live = await openProject(true);
  const original = await download(page, live);
  expect(original.identity.orphans).toHaveLength(500);
  await live.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const input = editor.getByRole('textbox', { name: 'Mermaid source' });
  await input.fill(revised.replace(/\r\n/g, '\n'));
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await expect(editor.getByRole('alert')).toContainText('retained annotation limits');
  await expect(editor.getByRole('button', { name: 'Apply source' })).toBeDisabled();
  const save = editor.getByRole('button', { name: 'Download source recovery file' });
  await expect(save).toBeVisible();
  await page.screenshot({ path: info.outputPath('source-recovery-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('source-recovery-mobile.png') });
  const [file] = await Promise.all([page.waitForEvent('download'), save.click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing source recovery file.');
  const content = await readFile(path, 'utf8');
  const recovery = JSON.parse(content);
  expect(recovery).toEqual({
    schema: 'meridian-recovery/v1', acceptedProject: original, sourceDraft: revised,
    reason: 'annotation-limit', baseStateDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await download(page, live)).toEqual(original);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  const reopened = await openProject();
  await reopened.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  await editor.getByText('Source recovery file', { exact: true }).click();
  const upload = (text: string) => editor.getByLabel('Source recovery file', { exact: true }).setInputFiles({
    name: 'draft.meridian-recovery.json', mimeType: 'application/json', buffer: Buffer.from(text),
  });
  await upload(JSON.stringify({ ...recovery, acceptedProject: { ...original, title: 'Changed in the file' } }));
  await expect(editor.getByRole('alert')).toContainText('does not match the accepted project it contains');
  await expect(input).toContainText('B[Second]');
  await upload(content);
  await expect(editor.getByRole('status')).toContainText('Source draft restored');
  await expect(input).toContainText('A[First]');
  await expect(input).not.toContainText('B[Second]');
  await expect(editor.getByRole('button', { name: 'Apply source' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await download(page, reopened)).toEqual(original);

  await reopened.getByRole('button', { name: 'Review unresolved annotations' }).click();
  const annotations = page.getByRole('dialog', { name: 'Unresolved annotations' });
  await annotations.getByRole('searchbox', { name: 'Find an annotation' }).fill('Former0');
  await annotations.getByRole('checkbox', { name: 'node:Former0', exact: true }).check();
  await annotations.getByRole('button', { name: 'Review removal' }).click();
  await annotations.getByRole('button', { name: 'Remove reviewed annotations' }).click();
  const cleaned = await download(page, reopened);
  expect(cleaned.source).toBe(source);
  expect(cleaned.identity.orphans).toHaveLength(499);
  await reopened.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  await editor.getByRole('button', { name: 'Discard draft' }).click();
  await editor.getByText('Source recovery file', { exact: true }).click();
  await upload(content);
  await expect(editor.getByRole('alert')).toContainText('matching accepted project revision');
  await expect(input).toContainText('B[Second]');
});

test('undoes a structural edit from reviewed source and keeps caret and Outline selection', async ({ page }) => {
  const source = 'flowchart LR\n  A[First]\n  B[Second]\n';
  const project = { ...createDocument(), title: 'Source project history', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Source project history' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  const editSource = live.getByRole('button', { name: 'Edit Mermaid source', exact: true });
  await editSource.click();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const input = editor.getByRole('textbox', { name: 'Mermaid source' });
  const manual = source + '  C[Third]\n';
  await input.fill(manual);
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await editor.getByRole('button', { name: 'Apply source' }).click();
  const accepted = await download(page, live);

  const openOutline = live.getByRole('button', { name: 'Outline', exact: true });
  await openOutline.click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const second = outline.getByRole('treeitem', { name: /^Second/ });
  await second.click();
  await second.press('F2');
  const rename = page.getByRole('dialog', { name: 'Edit flowchart' });
  await rename.getByRole('textbox', { name: 'Node label' }).fill('Reviewed second');
  await rename.getByRole('button', { name: 'Preview change' }).click();
  await rename.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const edited = await download(page, live);
  expect(edited.source).toContain('Reviewed second');

  await editSource.click();
  await expect(input).toBeFocused();
  await input.press('Control+Home');
  await input.press('ArrowDown');
  await input.press('Home');
  await input.press('Shift+End');
  await expect.poll(() => input.evaluate(() => window.getSelection()?.toString())).toBe('A[First]');
  const history = editor.getByRole('group', { name: 'Project history' });
  await history.getByRole('button', { name: 'Undo project edit' }).press('Enter');
  await expect(input).toBeFocused();
  await expect(input).toContainText('B[Second]');
  await expect(input).toContainText('C[Third]');
  await expect.poll(() => input.evaluate(() => window.getSelection()?.toString())).toBe('A[First]');
  await expect(history.getByRole('button', { name: 'Redo project edit' })).toBeEnabled();
  await input.press('End');
  await input.press('Space');
  await expect(history.getByRole('button', { name: 'Undo project edit' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Discard draft' }).click();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  const restored = await download(page, live);
  expect(restored).toEqual({ ...accepted, revision: edited.revision + 1, updatedAt: restored.updatedAt });
  await openOutline.click();
  await expect(outline.getByRole('status')).toHaveText('1 selected · 0 hidden');
  await expect(second).toHaveAttribute('aria-selected', 'true');
});

test('refuses a stale diagnostic fix and applies a refreshed bracket only to the draft', async ({ page }) => {
  const source = 'flowchart LR\r\n  B[Second]\r\n  A[First]\r\n';
  const project = { ...createDocument(), title: 'Diagnostic source repair', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Diagnostic source repair' }).click();

  const live = page.getByRole('dialog', { name: project.title, exact: true });
  const original = await download(page, live);
  await live.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const input = editor.getByRole('textbox', { name: 'Mermaid source' });
  const preview = editor.getByRole('button', { name: 'Preview source' });
  const repair = editor.getByRole('region', { name: 'Reviewed diagnostic fix' });
  const fix = repair.getByRole('button', { name: 'Apply fix to draft' });
  const firstDraft = 'flowchart LR\n  B[Reviewed second]\n  A[Revised';
  const refreshedDraft = firstDraft.replace('Revised', 'Updated');
  await input.fill(firstDraft);
  await preview.click();
  await expect(editor.getByRole('alert')).toContainText('Mermaid syntax · Line 3');
  await expect(repair.getByText('A[Revised]', { exact: true })).toBeVisible();
  await input.fill(refreshedDraft);
  await expect(repair.getByText('Preview the current source to refresh this fix.')).toBeVisible();
  await fix.click();
  await expect(editor.getByRole('status')).toContainText('The draft changed after this fix was reviewed.');
  expect((await input.locator('.cm-line').allTextContents()).join('\n')).toBe(refreshedDraft);
  await expect(editor.getByRole('button', { name: 'Apply source' })).toBeDisabled();

  await preview.click();
  await expect(repair.getByText('A[Updated]', { exact: true })).toBeVisible();
  await fix.click();
  await expect(repair).toHaveCount(0);
  await expect(input).toBeFocused();
  expect((await input.locator('.cm-line').allTextContents()).join('\n')).toBe(refreshedDraft + ']');
  await expect(editor.getByRole('button', { name: 'Apply source' })).toBeDisabled();
  await preview.click();
  await editor.getByRole('button', { name: 'Apply source' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const accepted = await download(page, live);
  expect(accepted.source).toBe((refreshedDraft + ']').replace(/\n/g, '\r\n'));
  expect(accepted.identity).toEqual(original.identity);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = await download(page, live);
  expect(undone).toEqual({ ...original, revision: accepted.revision + 1, updatedAt: undone.updatedAt });
});

test('keeps failed candidates unapplied and lets an accepted drawing recover after a mount error', async ({ page }) => {
  const source = 'flowchart LR\n  A[First]\n  B[Second]\n  A link@--> B\n';
  const project = { ...createDocument(), title: 'Drawing recovery', source };
  await page.addInitScript(({ key, project }) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }));
    const parse = DOMParser.prototype.parseFromString;
    const createUrl = URL.createObjectURL;
    let rejectNextSvg = false;
    let rejectNextDrawing = false;
    window.addEventListener('test-candidate-render-failure', () => { rejectNextSvg = true; });
    window.addEventListener('test-accepted-image-failure', () => { rejectNextDrawing = true; });
    DOMParser.prototype.parseFromString = function(text, type) {
      if (rejectNextSvg && type === 'image/svg+xml') {
        rejectNextSvg = false;
        document.documentElement.dataset.candidateFault = 'used';
        return parse.call(this, '<malformed', type);
      }
      return parse.call(this, text, type);
    };
    URL.createObjectURL = function(blob) {
      if (rejectNextDrawing && blob instanceof Blob && blob.type === 'image/svg+xml') {
        rejectNextDrawing = false;
        document.documentElement.dataset.drawingFault = 'used';
        return createUrl(new Blob(['<broken'], { type: 'image/svg+xml' }));
      }
      return createUrl(blob);
    };
  }, { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Drawing recovery' }).click();

  const live = page.getByRole('dialog', { name: project.title, exact: true });
  const drawing = live.getByRole('img', { name: 'Diagram preview for Drawing recovery' });
  const undo = live.getByRole('button', { name: 'Undo', exact: true });
  await expect.poll(() => drawing.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  const original = await download(page, live);
  await expect(undo).toBeDisabled();
  const edit = live.getByRole('button', { name: 'Edit Mermaid source', exact: true });
  const review = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  const input = review.getByRole('textbox', { name: 'Mermaid source' });
  const preview = review.getByRole('button', { name: 'Preview source' });
  const apply = review.getByRole('button', { name: 'Apply source' });
  const revised = source.replace('A[First]', 'A[Updated]');
  await edit.click();
  await input.fill(revised);
  await page.evaluate(() => window.dispatchEvent(new Event('test-candidate-render-failure')));
  await preview.click();
  await expect(review.getByRole('alert')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-candidate-fault', 'used');
  await expect(apply).toBeDisabled();
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await download(page, live)).toEqual(original);
  await expect(undo).toBeDisabled();

  await edit.click();
  await expect(input).toContainText('A[Updated]');
  await preview.click();
  await expect(apply).toBeEnabled();
  await page.evaluate(() => window.dispatchEvent(new Event('test-accepted-image-failure')));
  await apply.click();
  await expect(live.getByRole('alert')).toContainText('The browser could not display the drawing.');
  await expect(page.locator('html')).toHaveAttribute('data-drawing-fault', 'used');
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  await expect(drawing).toHaveCount(0);
  await expect(undo).toBeEnabled();
  const accepted = await download(page, live);
  expect(accepted.source).toBe(revised);
  expect(accepted.identity).toEqual(original.identity);

  await live.getByRole('button', { name: 'Retry drawing' }).click();
  await expect.poll(() => drawing.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(await download(page, live)).toEqual(accepted);
  await undo.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = await download(page, live);
  expect(undone).toEqual({ ...original, revision: accepted.revision + 1, updatedAt: undone.updatedAt });
});

test('keeps a native composition together and defers source review until it is committed', async ({ page, context }) => {
  const source = 'flowchart LR\n  A["First"]\n  B["Second"]\n';
  const project = { ...createDocument(), title: 'Source composition', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Source composition' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  await expect(live.getByRole('img', { name: /Diagram preview for/ })).toBeVisible();
  const before = await download(page, live);
  await live.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source', exact: true });
  const input = editor.getByRole('textbox', { name: 'Mermaid source' });
  await expect(input).toBeFocused();
  const preview = editor.getByRole('button', { name: 'Preview source' });

  const session = await context.newCDPSession(page);
  const compose = (text: string) => session.send('Input.imeSetComposition', {
    text, selectionStart: text.length, selectionEnd: text.length,
  });
  try {
    await input.press('Control+End');
    await input.press('Control+Space');
    await expect(editor.getByRole('option', { name: /^node/ })).toBeVisible();
    await input.press('Escape');
    await compose('no');
    await expect(input).toContainText('no');
    await expect(preview).toBeDisabled();
    await input.press('Control+Space');
    await expect(editor.getByRole('listbox')).toHaveCount(0);
    await compose('');

    await input.press('Control+Home');
    await input.press('ArrowDown');
    await input.press('End');
    await input.press('ArrowLeft');
    await input.press('ArrowLeft');
    await compose('に');
    await expect(input).toContainText('Firstに');
    await expect(preview).toBeDisabled();
    await compose('日本');
    await expect(input).toContainText('First日本');
    await expect(preview).toBeDisabled();
    await session.send('Input.insertText', { text: '日本' });
    await expect(preview).toBeEnabled();

    await input.press('Control+z');
    await expect(input).toContainText('A["First"]');
    await expect(input).not.toContainText('日本');
    await expect(preview).toBeDisabled();
    await input.press('Control+y');
    await expect(input).toContainText('A["First日本"]');
    await preview.click();
    await editor.getByRole('button', { name: 'Apply source' }).click();
  } finally { await session.detach(); }

  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const accepted = await download(page, live);
  expect(accepted.source).toBe(source.replace('First', 'First日本'));
  expect(accepted.identity).toEqual(before.identity);

  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const second = page.getByRole('treeitem', { name: /^Second/ });
  await second.click();
  await second.press('F2');
  const rename = page.getByRole('dialog', { name: 'Edit flowchart' });
  await rename.getByRole('textbox', { name: 'Node label' }).fill('Reviewed second');
  await rename.getByRole('button', { name: 'Preview change' }).click();
  await rename.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const renamed = await download(page, live);
  expect(renamed.source).toBe(accepted.source.replace('Second', 'Reviewed second'));
  expect(renamed.identity).toEqual(accepted.identity);

  await live.getByRole('button', { name: 'Explore designs', exact: true }).click();
  const designs = page.getByRole('dialog', { name: 'Explore designs' });
  await designs.getByRole('group', { name: 'Design recipes' }).getByRole('button', { name: /^Presentation/ }).click();
  await designs.getByRole('button', { name: 'Preview Presentation' }).click();
  await designs.getByRole('button', { name: 'Apply Presentation' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const styled = await download(page, live);
  expect(styled.source).toBe(renamed.source);
  expect(styled.identity).toEqual(renamed.identity);
  expect(styled.design.recipe).toMatchObject({ id: 'presentation' });

  let revision = styled.revision;
  for (const [action, states] of [['Undo', [renamed, accepted, before]], ['Redo', [accepted, renamed, styled]]] as const) {
    for (const state of states) {
      await live.getByRole('button', { name: action, exact: true }).click();
      await expect(live.getByText('Saved in this browser.')).toBeVisible();
      const restored = await download(page, live);
      expect(restored).toEqual({ ...state, revision: ++revision, updatedAt: restored.updatedAt });
    }
  }
});
