import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
const origin = 'https://companion.example.invalid';
const root = resolve('companion/dist');

test('reviews the file locally, obtains consent, and recovers a downloaded result after stopping the wait', async ({ page }) => {
  const { companionFixture, operation, policy } = await import('../../companion/.fixtures/dist/companion-fixture.js');
  const { request, bytes, requestHash, api, done, completed, settled, providerCalls, close } = await companionFixture(origin);
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  await page.route(`${origin}/**`, async route => {
    const incoming = route.request();
    const { pathname } = new URL(incoming.url());
    if (pathname.startsWith('/v1/')) {
      const method = incoming.method();
      const body = incoming.postData() ?? undefined;
      calls.push({ method, path: pathname, body: body ? JSON.parse(body) : undefined });
      const response = await api(new Request(incoming.url(), { method, body, headers: await incoming.allHeaders() }));
      if (method === 'POST' && pathname === '/v1/proposals') completed();
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      return;
    }
    const html = pathname === '/';
    if (!html && !/^\/assets\/[a-zA-Z0-9_-]+\.(?:css|js)$/.test(pathname)) return route.abort();
    const mime = html ? 'text/html' : pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
    await route.fulfill({ headers: { 'content-type': mime, 'content-security-policy': "frame-ancestors 'none'" },
      body: await readFile(resolve(root, html ? 'index.html' : pathname.slice(1))) });
  });
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(origin);
    await expect(page.getByText('Isolated model fixture', { exact: false })).toBeVisible();
    const picker = page.getByLabel('Choose a Meridian request');
    await picker.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"bad":true}') });
    await expect(page.getByRole('alert')).toContainText('valid Meridian assistant request file');
    await picker.setInputFiles({ name: 'request.json', mimeType: 'application/json', buffer: bytes });
    const disclosure = page.getByRole('region', { name: 'What will be shared' });
    await expect(disclosure.getByText('Rename only the writable node.', { exact: true })).toBeVisible();
    await expect(disclosure.getByText('Service (aaaaaaaa)', { exact: false })).toContainText('Writable');
    await expect(disclosure.getByText('Service (bbbbbbbb)', { exact: false })).toContainText('Read-only context');
    const generate = page.getByRole('button', { name: 'Generate proposal' });
    await expect(generate).toBeDisabled();
    expect(calls.map(call => call.method)).toEqual(['GET']);
    await page.getByRole('checkbox', { name: /maximum charge of \$0\.000038 USD/ }).check();
    await generate.click();
    await expect.poll(providerCalls).toBe(1);
    expect(calls[1]).toMatchObject({ method: 'POST', path: '/v1/tickets', body: {
      requestId: request.requestId, requestHash, acknowledgeBillableRequest: true,
      pricePolicyVersion: policy.version, acknowledgedMaxChargeMicrousd: '38',
    } });
    expect(JSON.stringify(calls[1])).not.toContain(request.instruction);
    expect(calls[2]).toMatchObject({ method: 'POST', path: '/v1/proposals', body: { request } });
    await page.getByRole('button', { name: 'Stop waiting' }).click();
    await expect(page.getByRole('alert')).toContainText('may have started and incurred a charge');
    await expect(generate).toBeDisabled();
    done();
    await settled;
    await page.getByRole('button', { name: 'Check status' }).click();
    await expect(page.getByRole('status')).toContainText('Charged $0.000009 USD.');
    const downloadPending = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download proposal' }).click();
    const download = await downloadPending;
    const filepath = await download.path();
    expect(download.suggestedFilename()).toBe('meridian-proposal.json');
    expect(JSON.parse(await readFile(filepath!, 'utf8'))).toMatchObject({
      requestId: request.requestId, requestHash, baseToken: request.baseToken, operations: [operation],
    });
    expect(providerCalls()).toBe(1);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('link', { name: 'Sign in to the companion' })).toHaveAttribute('href', '/auth/login');
    await expect(disclosure).toHaveCount(0);
  } finally {
    done();
    if (providerCalls()) await settled;
    close();
  }
});
