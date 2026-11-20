import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { canonicalDigest } from '../../src/lib/authoring/base-token';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing local exchange file.');
  return readFile(path, 'utf8');
}

test('exports scoped facts offline, rejects context-only changes, and applies a matched rename once with Undo', async ({ page, context }, info) => {
  const source = 'flowchart LR\n A[First]\n B[Context node]\n C[Excluded node]\n A path@--> B\n %% original-source-only\n';
  const project = { ...createDocument(), title: 'Scoped exchange', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(
    key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }),
  ), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Scoped exchange' }).click();
  const live = page.getByRole('dialog', { name: 'Scoped exchange' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Scoped exchange' })).toBeVisible();
  const before = await download(page, live.getByRole('button', { name: 'Download v3 project' }));
  async function openExchange() {
    await live.getByRole('button', { name: 'Commands' }).click();
    const commands = page.getByRole('dialog', { name: 'Commands' });
    await commands.getByRole('combobox').fill('external assistant');
    await commands.getByRole('option', { name: /External assistant file exchange/ }).click();
    const dialog = page.getByRole('dialog', { name: 'External assistant file exchange' });
    await expect(dialog).toBeVisible();
    return dialog;
  }
  const dialog = await openExchange();
  await context.setOffline(true);
  await dialog.getByLabel('Instruction').fill('Use a short literal label on the writable node.');
  await dialog.getByRole('combobox', { name: 'First', exact: true }).selectOption('writable');
  await dialog.getByRole('combobox', { name: 'Context node', exact: true }).selectOption('context');
  await dialog.getByRole('button', { name: 'Review what will be shared' }).click();
  await expect(dialog.getByRole('region', { name: 'What will be shared' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('request-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('request-mobile.png') });
  const text = await download(page, dialog.getByRole('button', { name: 'Download request' }));
  expect(text).not.toMatch(/original-source-only|Excluded node|"source":|"storyboard":|"svg":/);
  const request = JSON.parse(text);
  const requestHash = await canonicalDigest('meridian-assist-request/v1', request);
  expect(request.requestId).toMatch(/^[a-f0-9-]{14}7[a-f0-9-]+$/);
  expect(request.graph.edges).toEqual([expect.objectContaining({ label: '' })]);
  const writable = request.graph.nodes.find((node: { label: string }) => node.label === 'First');
  const contextOnly = request.graph.nodes.find((node: { label: string }) => node.label === 'Context node');
  expect(request.scope.writableElementIds).toEqual([writable.id]);
  expect(request.scope.attachmentPointIds).toEqual([]);
  expect(request.allowedOperations).toEqual(['setNodeLabel']);
  const pending = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open('meridian-workspace');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('pendingAssist');
      const read = tx.objectStore('pendingAssist').getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    open.onerror = () => reject(open.error);
  }));
  expect(pending).toEqual([expect.objectContaining({ id: request.requestId, requestHash })]);
  expect(JSON.stringify(pending)).not.toMatch(/literal label|Context node/);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  expect(await download(page, live.getByRole('button', { name: 'Download v3 project' }))).toBe(before);

  await openExchange();
  await dialog.getByRole('button', { name: 'Review a proposal' }).click();
  const proposal = {
    schema: 'meridian-proposal/v1', id: crypto.randomUUID(), documentKind: 'mermaid', origin: 'ai',
    requestId: request.requestId, requestHash, baseToken: request.baseToken,
    operations: [{ op: 'setNodeLabel', targetId: writable.id, label: 'Reviewed label' }],
  };
  async function review(value: object) {
    await dialog.getByLabel('Assistant proposal file').setInputFiles({
      name: 'return.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
    });
    await dialog.getByRole('button', { name: 'Preview unverified suggestion' }).click();
  }
  await review({ ...proposal, origin: 'canvas' });
  await expect(dialog.getByRole('alert')).toContainText('one supported node rename');
  await review({ ...proposal, operations: [{ ...proposal.operations[0], targetId: contextOnly.id }] });
  await expect(dialog.getByRole('alert')).toContainText('outside the request’s writable scope');
  await review({ ...proposal, baseToken: { ...proposal.baseToken, stateDigest: 'a'.repeat(64) } });
  await expect(dialog.getByRole('alert')).toContainText('does not match a live request');
  await review(proposal);
  await expect(dialog.getByRole('img', { name: 'Diagram preview with proposed node label' })).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Unverified suggestion' })).toContainText('Rename First to Reviewed label.');
  await dialog.getByRole('button', { name: 'Apply reviewed rename' }).click();
  await expect(dialog).toBeHidden();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const original = JSON.parse(before);
  const after = JSON.parse(await download(page, live.getByRole('button', { name: 'Download v3 project' })));
  expect(after).toEqual({
    ...original, source: source.replace('[First]', '["Reviewed label"]'),
    revision: original.revision + 1, updatedAt: after.updatedAt,
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = JSON.parse(await download(page, live.getByRole('button', { name: 'Download v3 project' })));
  expect(restored).toEqual({ ...original, revision: after.revision + 1, updatedAt: restored.updatedAt });
  await openExchange();
  await dialog.getByRole('button', { name: 'Review a proposal' }).click();
  await review(proposal);
  await expect(dialog.getByRole('alert')).toContainText('no longer matches a live request');
});
