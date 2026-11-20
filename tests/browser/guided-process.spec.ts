import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

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
  await expect(wizard.getByText(/Draft saved locally · expires/)).toBeVisible();
  await wizard.getByRole('button', { name: 'Back to steps' }).click();
  await wizard.getByLabel('Put one step on each line').fill('New unreviewed entry');

  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const resume = wizard.getByRole('button', { name: /Resume Reviewed draft/ });
  await expect(resume).toContainText(/Saved .* expires /);
  await resume.click();
  await expect(wizard.getByText('3 steps · 2 connections · New project')).toBeVisible();
  await expect(wizard.getByText('Next: Review')).toBeVisible();
  await expect(wizard.getByText('New unreviewed entry')).toHaveCount(0);
  await expect(wizard.getByText('From line 1: 1. Start')).toHaveCount(0);
  await wizard.getByRole('button', { name: 'Preview process' }).click();
  await wizard.getByRole('button', { name: 'Create process' }).click();
  await expect(page.getByRole('dialog', { name: 'Reviewed draft' }).getByText('Saved in this browser.')).toBeVisible();

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
  await wizard.getByLabel('Put one step on each line').fill('Read request\nReply');
  await wizard.getByRole('button', { name: 'Review connections' }).click();
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
