import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectWorkspaceOmits } from './helpers';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

test('creates a reviewed five-step v3 process without writing source', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const wizard = page.getByRole('dialog', { name: 'Build with guidance' });
  await wizard.getByLabel('Project title').fill('Request process');
  await wizard.getByLabel('Put one step on each line').fill('1. Receive\n\n- Review\n1.2 API\nReview\nPublish');
  await wizard.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await expect(wizard.getByLabel('Put one step on each line')).toHaveValue('1. Receive\n\n- Review\n1.2 API\nReview\nPublish');
  await wizard.getByRole('button', { name: 'Review connections' }).click();
  await expect(wizard.getByText('5 steps · 4 connections · New project')).toBeVisible();
  await expect(wizard.getByText('Next: 1.2 API')).toBeVisible();
  await expect(wizard.getByText('From line 1: 1. Receive')).toBeVisible();
  await wizard.getByRole('button', { name: 'Preview process' }).click();
  await expect(wizard.getByRole('button', { name: 'Create process' })).toBeEnabled();
  await expect(wizard.getByRole('img', { name: 'Proposed process diagram' })).toBeVisible();
  await wizard.getByRole('button', { name: 'Create process' }).click();
  const project = page.getByRole('dialog', { name: 'Request process' });
  await expect(project.getByText('Saved in this browser.')).toBeVisible();
  const pendingDownload = page.waitForEvent('download');
  await project.getByRole('button', { name: 'Download v3 project' }).click();
  const downloaded = await (await pendingDownload).path();
  if (!downloaded) throw new Error('No downloaded project.');
  const result = JSON.parse(await readFile(downloaded, 'utf8'));
  expect(result).toMatchObject({ schema: 'meridian/v3', title: 'Request process', revision: 0 });
  expect(result.source).toBe([
    'flowchart LR',
    '  m_n1["Receive"]', '  m_n2["Review"]', '  m_n3["1.2 API"]', '  m_n4["Review"]', '  m_n5["Publish"]',
    '  m_n1 m_e1@--> m_n2', '  m_n2 m_e2@--> m_n3', '  m_n3 m_e3@--> m_n4', '  m_n4 m_e4@--> m_n5', '',
  ].join('\n'));
  expect(new Set(result.identity.elements.map((element: { id: string }) => element.id)).size).toBe(9);
  expect(await page.evaluate(() => localStorage.getItem('meridian:v2'))).toBeNull();
});

test('keeps the guided input when the renderer cannot display a label exactly', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const wizard = page.getByRole('dialog', { name: 'Build with guidance' });
  const input = 'Start\nA|B';
  await wizard.getByLabel('Put one step on each line').fill(input);
  await wizard.getByRole('button', { name: 'Review connections' }).click();
  await wizard.getByRole('button', { name: 'Preview process' }).click();
  await expect(wizard.getByRole('alert')).toContainText("could not display node 2's label exactly");
  await expect(wizard.getByRole('button', { name: 'Create process' })).toHaveCount(0);
  await wizard.getByRole('button', { name: 'Back to steps' }).click();
  await expect(wizard.getByLabel('Put one step on each line')).toHaveValue(input);
});

test('resumes a normalized draft after reload and clears it after creating the project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const wizard = page.getByRole('dialog', { name: 'Build with guidance' });
  await wizard.getByLabel('Project title').fill('Reviewed draft');
  await wizard.getByLabel('Put one step on each line').fill('1. Start\n\n• Review\nFinish');
  await wizard.getByRole('button', { name: 'Review connections' }).click();
  await expect(wizard.getByText(/Draft saved locally at .* · expires/)).toBeVisible();
  await wizard.getByRole('button', { name: 'Back to steps' }).click();
  await expectWorkspaceOmits(page, ['1. Start', '• Review']);
  await wizard.getByLabel('Put one step on each line').fill('New unreviewed entry');

  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const resume = wizard.getByRole('button', { name: /Resume Reviewed draft/ });
  await expect(resume).toContainText(/Saved .* expires /);
  await expect(resume.locator('time')).toHaveCount(2);
  const dates = await resume.locator('time').evaluateAll(times => times.map(time => time.getAttribute('datetime')));
  expect(dates).toHaveLength(2);
  expect(Date.parse(dates[1]!) - Date.parse(dates[0]!)).toBe(7 * 24 * 60 * 60 * 1_000);
  await resume.click();
  const restored = wizard.getByRole('status').filter({ hasText: 'Draft saved locally at' });
  await expect(restored).toContainText(/Draft saved locally at .* · expires /);
  for (const [index, date] of dates.entries()) await expect(restored.locator('time').nth(index)).toHaveAttribute('datetime', date!);
  await expect(wizard.getByText('3 steps · 2 connections · New project')).toBeVisible();
  await expect(wizard.getByText('Next: Review')).toBeVisible();
  await expect(wizard.getByText('New unreviewed entry')).toHaveCount(0);
  await expect(wizard.getByText('From line 1: 1. Start')).toHaveCount(0);
  await wizard.getByRole('button', { name: 'Preview process' }).click();
  await wizard.getByRole('button', { name: 'Create process' }).click();
  await expect(page.getByRole('dialog', { name: 'Reviewed draft' }).getByText('Saved in this browser.')).toBeVisible();
  await expectWorkspaceOmits(page, ['1. Start', '• Review', 'New unreviewed entry']);

  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await expect(wizard.getByRole('button', { name: /Resume Reviewed draft/ })).toHaveCount(0);
  const storedDrafts = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('meridian-workspace');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction('drafts').objectStore('drafts').count();
      read.onerror = () => { db.close(); reject(read.error); };
      read.onsuccess = () => { db.close(); resolve(read.result); };
    };
  }));
  expect(storedDrafts).toBe(0);
});

test('guidance keeps session input available when draft storage fails', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts') throw new DOMException('Draft storage is full.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const wizard = page.getByRole('dialog', { name: 'Build with guidance' });
  await wizard.getByLabel('Project title').fill('Session draft');
  await wizard.getByLabel('Put one step on each line').fill('1. Read request\n\n- Reply');
  await wizard.getByRole('button', { name: 'Review connections' }).click();
  await expect(wizard.getByRole('alert')).toHaveText('Session-only draft. Draft storage is full.');
  const [recoveredFile] = await Promise.all([page.waitForEvent('download'),
    wizard.getByRole('button', { name: 'Download normalized draft' }).click()]);
  expect(recoveredFile.suggestedFilename()).toBe('process.meridian-draft.json');
  const draftPath = await recoveredFile.path();
  if (!draftPath) throw new Error('Missing normalized draft download.');
  const text = await readFile(draftPath, 'utf8');
  const draft = JSON.parse(text);
  expect(draft).toMatchObject({ schema: 'meridian-draft/v1', feature: 'guided', baseToken: null, payload: {
    title: 'Session draft', intent: 'process', mode: 'linear',
    nodes: [{ label: 'Read request', sourceRow: 1 }, { label: 'Reply', sourceRow: 3 }],
    edges: [{ sourceId: 'step-1', targetId: 'step-2', review: 'accepted' }],
  } });
  expect(text).not.toMatch(/1\. Read request|- Reply|original|sourceCode|\"text\"/);
  await expect(wizard.getByRole('alert')).toHaveText('Session-only draft. Draft storage is full.');
  await wizard.getByRole('button', { name: 'Preview process' }).click();
  await wizard.getByRole('button', { name: 'Create process' }).click();
  await expect(page.getByRole('dialog', { name: 'Session draft' }).getByText('Saved in this browser.')).toBeVisible();
});

test('guided normalization stops timed-out workers and cancels on close', async ({ page }) => {
  await page.addInitScript(() => {
    const nativePost = Worker.prototype.postMessage;
    const nativeTerminate = Worker.prototype.terminate;
    const blockedWorkers = new WeakSet<Worker>();
    let stoppedWorkers = 0;

    Worker.prototype.postMessage = function (...args) {
      if (args[0]?.version === 1 && typeof args[0]?.text === 'string') {
        blockedWorkers.add(this);
        return;
      }
      return nativePost.apply(this, args);
    };
    Worker.prototype.terminate = function () {
      if (blockedWorkers.delete(this)) {
        document.documentElement.dataset.stoppedProcessWorkers = String(++stoppedWorkers);
      }
      nativeTerminate.call(this);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const wizard = page.getByRole('dialog', { name: 'Build with guidance' });
  const field = wizard.getByLabel('Put one step on each line');
  const input = 'Start\nReview\nFinish';
  await field.fill(input);
  await wizard.getByRole('button', { name: 'Review connections' }).click();
  const retry = wizard.getByRole('button', { name: 'Retry for five seconds' });
  await expect(retry).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute('data-stopped-process-workers', '1');
  await retry.click();
  await expect(wizard.getByRole('alert')).toHaveText('Shorten your process list before trying again.');
  await expect(page.locator('html')).toHaveAttribute('data-stopped-process-workers', '2');
  await expect(field).toHaveValue(input);
  const review = wizard.getByRole('button', { name: 'Review connections' });
  await expect(review).toBeDisabled();
  await field.fill('Start\nFinish');
  await review.click();
  await expect(wizard.getByText('Reading process steps…')).toBeVisible();
  await wizard.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-stopped-process-workers', '3', { timeout: 1_000 });
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await expect(wizard.getByRole('button', { name: /^Resume / })).toHaveCount(0);
});

test('guided normalization runs in the standalone app with networking disabled', async ({ page, context }) => {
  const network: string[] = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await context.setOffline(true);
  await page.goto(pathToFileURL(resolve('standalone/Meridian.html')).href);
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const wizard = page.getByRole('dialog', { name: 'Build with guidance' });
  await wizard.getByLabel('Put one step on each line').fill('1. Start\nFinish');
  await wizard.getByRole('button', { name: 'Review connections' }).click();
  await expect(wizard.getByText('2 steps · 1 connections · New project')).toBeVisible();
  await expect(wizard.getByText('From line 1: 1. Start')).toBeVisible();
  expect(network).toEqual([]);
});

test('reviews and resumes explicit approval branches without connecting approve to reject', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const wizard = page.getByRole('dialog', { name: 'Build with guidance' });
  await wizard.getByLabel('Project title').fill('Approval process');
  await wizard.getByLabel('Put one step on each line').fill('Start\nDecision\nApprove\nReject\nComplete');
  await wizard.getByRole('button', { name: 'Review connections' }).click();
  await wizard.getByRole('button', { name: 'Make Decision a decision' }).click();
  const connection = (index: number) => wizard.getByRole('group', { name: `Connection ${index}`, exact: true });
  const preview = wizard.getByRole('button', { name: 'Preview process' });
  await preview.click();
  await expect(wizard.getByRole('alert')).toHaveText('Keep or remove the connection from Decision to Approve.');
  await connection(2).getByLabel('Connection label').fill('Approve request');
  await connection(2).getByRole('button', { name: 'Keep connection' }).click();
  await connection(3).getByRole('button', { name: 'Remove connection' }).click();
  await wizard.getByLabel('Mark Complete as an end').check();
  await wizard.getByRole('button', { name: 'Move Reject up' }).click();
  await wizard.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(wizard.getByText(/Draft saved locally at .* · expires/)).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await wizard.getByRole('button', { name: /Resume Approval process/ }).click();
  const steps = wizard.getByRole('list', { name: 'Process steps' }).getByRole('listitem');
  await expect(steps.nth(2)).toContainText('Reject');
  await expect(steps.nth(3)).toContainText('Approve');
  await wizard.getByRole('button', { name: 'Move Approve up' }).click();
  await expect(wizard.getByLabel('Mark Complete as an end')).toBeChecked();
  await expect(connection(2).getByLabel('Connection label')).toHaveValue('Approve request');
  await expect(connection(2).getByText('Review connection')).toHaveCount(0);
  await expect(connection(3).getByText('Review connection')).toBeVisible();
  await connection(3).getByRole('button', { name: 'Keep connection' }).click();
  const rejectEnd = wizard.getByLabel('Mark Reject as an end');
  await rejectEnd.check();
  await preview.click();
  await expect(wizard.getByRole('alert')).toHaveText('Reject is marked as an end and cannot connect to Complete.');
  await rejectEnd.uncheck();
  const add = wizard.getByRole('button', { name: 'Add connection', exact: true });
  await add.click();
  await connection(4).getByLabel('From').selectOption({ label: 'Decision · line 2' });
  await connection(4).getByLabel('To').selectOption({ label: 'Reject · line 4' });
  await connection(4).getByLabel('Connection label').fill('Reject request');
  await connection(4).getByRole('button', { name: 'Keep connection' }).click();
  await add.click();
  await connection(5).getByLabel('From').selectOption({ label: 'Approve · line 3' });
  await connection(5).getByLabel('To').selectOption({ label: 'Complete · line 5' });
  await connection(5).getByRole('button', { name: 'Keep connection' }).click();
  await preview.click();
  const create = wizard.getByRole('button', { name: 'Create process' });
  await expect(create).toBeEnabled();
  const reviewed = wizard.getByRole('list', { name: 'Reviewed connections' });
  await expect(reviewed.getByRole('listitem')).toHaveText([
    'Start → Decision', 'Decision → Approve (Approve request)', 'Reject → Complete',
    'Decision → Reject (Reject request)', 'Approve → Complete',
  ]);
  await create.click();
  const project = page.getByRole('dialog', { name: 'Approval process' });
  await expect(project.getByText('Saved in this browser.')).toBeVisible();
  const pendingDownload = page.waitForEvent('download');
  await project.getByRole('button', { name: 'Download v3 project' }).click();
  const downloaded = await (await pendingDownload).path();
  if (!downloaded) throw new Error('No downloaded project.');
  const result = JSON.parse(await readFile(downloaded, 'utf8'));
  expect(result.source).toBe([
    'flowchart LR', '  m_n1["Start"]', '  m_n2{"Decision"}', '  m_n3["Approve"]', '  m_n4["Reject"]', '  m_n5["Complete"]',
    '  m_n1 m_e1@--> m_n2', '  m_n2 m_e2@-->|"Approve request"| m_n3', '  m_n4 m_e3@--> m_n5',
    '  m_n2 m_e4@-->|"Reject request"| m_n4', '  m_n3 m_e5@--> m_n5', '',
  ].join('\n'));
});

test('inserts reviewed process branches after refreshing a changed target and undoes the exact insertion', async ({ page }) => {
  const source = '\uFEFFflowchart TB\r\n  A[Intake]\r\n  B[Archive]\r\n  A original@--> B\r\n';
  const project = { ...createDocument(), title: 'Process insertion target', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });

  async function openTarget(tab: Page, prepare: boolean) {
    await tab.goto('/');
    await tab.getByRole('button', { name: 'Manage projects' }).click();
    await tab.getByRole('button', { name: 'Project migration and recovery' }).click();
    if (prepare) await tab.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await tab.getByRole('button', { name: 'Open v3 project Process insertion target' }).click();
    const live = tab.getByRole('dialog', { name: project.title, exact: true });
    await expect(live.getByRole('img', { name: /Diagram preview for/ })).toBeVisible();
    return live;
  }

  async function download(tab: Page, live: Locator) {
    const [file] = await Promise.all([
      tab.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click(),
    ]);
    const path = await file.path();
    if (!path) throw new Error('Missing process project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  }

  const original = await openTarget(page, true);
  await original.getByRole('button', { name: 'Insert process diagram', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'Insert process diagram', exact: true });
  const stepInput = wizard.getByLabel('Put one step on each line');
  await expect(stepInput).toBeFocused();
  await stepInput.fill('Start\nDecision\nAccept\nReject');
  await wizard.getByRole('button', { name: 'Review connections' }).click();
  await wizard.getByRole('button', { name: 'Make Decision a decision' }).click();
  const connection = (n: number) => wizard.getByRole('group', { name: `Connection ${n}`, exact: true });
  await connection(2).getByLabel('Connection label').fill('Accept it');
  await connection(2).getByRole('button', { name: 'Keep connection' }).click();
  await connection(3).getByRole('button', { name: 'Remove connection' }).click();
  await wizard.getByLabel('Mark Accept as an end').check();
  await wizard.getByLabel('Mark Reject as an end').check();
  await wizard.getByRole('button', { name: 'Add connection', exact: true }).click();
  await connection(3).getByLabel('From').selectOption({ label: 'Decision · line 2' });
  await connection(3).getByLabel('To').selectOption({ label: 'Reject · line 4' });
  await connection(3).getByLabel('Connection label').fill('Reject it');
  await connection(3).getByRole('button', { name: 'Keep connection' }).click();

  const attachment = wizard.getByRole('group', { name: 'Attachment to this project' });
  await attachment.getByRole('combobox', { name: 'Existing node', exact: true }).selectOption({ label: 'Intake (A)' });
  await attachment.getByRole('combobox', { name: 'Draft node', exact: true }).selectOption({ label: 'Accept · line 3' });
  await attachment.getByRole('combobox', { name: 'Attachment direction', exact: true }).selectOption('to-existing');
  const preview = wizard.getByRole('button', { name: 'Preview process' });
  const insert = wizard.getByRole('button', { name: 'Insert process', exact: true });
  await preview.click();
  await expect(wizard.getByRole('alert')).toHaveText('A step marked as an end cannot have an outgoing attachment.');
  await attachment.getByRole('combobox', { name: 'Draft node', exact: true }).selectOption({ label: 'Start · line 1' });
  await attachment.getByRole('combobox', { name: 'Attachment direction', exact: true }).selectOption('from-existing');
  await preview.click();
  await expect(wizard.getByText('Attachment Intake (A) → Start · line 1', { exact: true })).toBeVisible();
  await expect(insert).toBeEnabled();

  const second = await page.context().newPage();
  try {
    const other = await openTarget(second, false);
    await other.getByRole('button', { name: 'Edit heading' }).click();
    const heading = second.getByRole('dialog', { name: 'Edit heading' });
    await heading.getByRole('textbox', { name: 'Title', exact: true }).fill('Updated process target');
    await heading.getByRole('button', { name: 'Apply heading' }).click();
    const updated = second.getByRole('dialog', { name: 'Updated process target', exact: true });
    await expect(updated.getByText('Saved in this browser.')).toBeVisible();
    const changed = await download(second, updated);

    await insert.click();
    await expect(wizard.getByRole('alert')).toContainText('The saved project changed.');
    await expect(wizard.getByLabel('Mark Accept as an end')).toBeChecked();
    await expect(connection(3).getByLabel('Connection label')).toHaveValue('Reject it');
    await expect(attachment.getByRole('combobox', { name: 'Attachment direction', exact: true })).toHaveValue('from-existing');
    expect(await download(second, updated)).toEqual(changed);

    await preview.click();
    await expect(wizard.getByText('Destination Updated process target', { exact: true })).toBeVisible();
    await insert.click();
    const live = page.getByRole('dialog', { name: 'Updated process target', exact: true });
    await expect(live.getByText('Saved in this browser.')).toBeVisible();
    const accepted = await download(page, live);
    expect(accepted.source).toBe(source + [
      '  m_n1["Start"]', '  m_n2{"Decision"}', '  m_n3["Accept"]', '  m_n4["Reject"]',
      '  m_n1 m_e1@--> m_n2', '  m_n2 m_e2@-->|"Accept it"| m_n3',
      '  m_n2 m_e3@-->|"Reject it"| m_n4', '  A m_e4@--> m_n1', '',
    ].join('\r\n'));
    expect(accepted.identity.elements.slice(0, changed.identity.elements.length)).toEqual(changed.identity.elements);
    await live.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(live.getByText('Saved in this browser.')).toBeVisible();
    const restored = await download(page, live);
    expect(restored).toEqual({ ...changed, revision: accepted.revision + 1, updatedAt: restored.updatedAt });
  } finally { await second.close(); }
});
