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
  expect(await input.evaluate((field: HTMLTextAreaElement) => field.value.slice(field.selectionStart, field.selectionEnd))).toBe(' A["unclosed');
  await expect(editor.getByRole('button', { name: 'Apply source' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  expect(await download(page, live)).toEqual(original);
  await open();
  await expect(input).toHaveValue(invalid);
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
  await expect(input).toHaveValue(source.replace(/\r\n/g, '\n'));
  await upload(content);
  await expect(editor.getByRole('status')).toContainText('Source draft restored');
  await expect(input).toHaveValue(revised.replace(/\r\n/g, '\n'));
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
  await expect(input).toHaveValue(source.replace(/\r\n/g, '\n'));
});
