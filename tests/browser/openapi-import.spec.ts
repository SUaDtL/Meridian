import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('reviews OpenAPI operations, keeps hidden selection, and stores precise provenance without raw file content', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Engineering file' });
  await dialog.getByLabel('OpenAPI JSON file').setInputFiles({
    name: 'service.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      openapi: '3.1.0',
      info: { description: 'raw-file-secret-fixture' },
      paths: {
        '/pets/{id}': { get: { operationId: 'readPet', tags: ['Pets', 'Read'], description: 'raw-description-secret-fixture' } },
        '/health': { get: { tags: ['Health'] } },
        '/external': { $ref: 'https://example.invalid/remote.json' },
      },
      components: { schemas: { Pet: { type: 'object' } } },
    })),
  });
  await dialog.getByLabel('Virtual path').fill('specifications/service.json');
  await dialog.getByRole('button', { name: 'Read operation facts' }).click();
  await expect(dialog.getByText(/Unresolved referenced path items: 1/)).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'GET /pets/{id}' }).check();
  await dialog.getByLabel('Primary tag').selectOption('Pets');
  await dialog.getByLabel('Find operations').fill('health');
  await expect(dialog.getByRole('status')).toContainText('1 selected outside visible rows');
  await dialog.getByLabel('Diagram title').fill('Pet operation reference');
  await dialog.getByRole('button', { name: 'Preview diagram' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed OpenAPI operation diagram' })).toBeVisible();
  await expect(dialog.getByText('2 nodes · 1 connection · 1 operation fact omitted')).toBeVisible();
  await page.screenshot({ path: info.outputPath('openapi-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('openapi-review-mobile.png') });
  await dialog.getByRole('button', { name: 'Create new diagram' }).click();
  const live = page.getByRole('dialog', { name: 'Pet operation reference' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Pet operation reference' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await download.path();
  if (!path) throw new Error('Missing OpenAPI project download.');
  const contents = await readFile(path, 'utf8');
  const project = JSON.parse(contents);
  expect(project.provenance).toContainEqual(expect.objectContaining({
    adapter: 'openapi-operations', adapterVersion: '1.0.0', virtualPath: 'specifications/service.json',
    pointer: '/paths/~1pets~1{id}/get/tags/0', relationship: 'Declared OpenAPI tag membership',
  }));
  expect(contents).not.toMatch(/raw-file-secret|raw-description-secret|example\.invalid|\/health/);
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('button', { name: 'Relationships' }).click();
  const source = outline.getByRole('region', { name: 'Imported source' });
  await expect(source).toContainText('Declared OpenAPI tag membership');
  await expect(source).toContainText('specifications/service.json#/paths/~1pets~1{id}/get/tags/0');
});
