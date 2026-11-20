import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('reviews OpenAPI operations, keeps hidden selection, and stores precise provenance without raw file content', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Engineering file' });
  await dialog.getByLabel('OpenAPI specification').setInputFiles({
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

test('recovers from invalid YAML and creates a reviewed operation diagram from one restricted document', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Engineering file' });
  async function openYaml(source: string) {
    await dialog.getByLabel('OpenAPI specification').setInputFiles({
      name: 'service.yaml', mimeType: 'application/yaml', buffer: Buffer.from(source),
    });
    await dialog.getByRole('button', { name: 'Read operation facts' }).click();
  }
  await openYaml('openapi: 3.1.0\npaths: {}\npaths: {}');
  await expect(dialog.getByRole('alert')).toContainText('repeated mapping key');
  await openYaml('openapi: 3.1.0\npaths:\n  /entries/{id}:\n    get:\n      operationId: readEntry\n      tags: [Entries]\n      description: raw-yaml-description');
  await dialog.getByRole('checkbox', { name: 'GET /entries/{id}' }).check();
  await dialog.getByLabel('Primary tag').selectOption('Entries');
  await dialog.getByLabel('Diagram title').fill('Entry operations');
  await dialog.getByRole('button', { name: 'Preview diagram' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed OpenAPI operation diagram' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('openapi-yaml-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('openapi-yaml-mobile.png') });
  await dialog.getByRole('button', { name: 'Create new diagram' }).click();
  const live = page.getByRole('dialog', { name: 'Entry operations' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Entry operations' })).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing OpenAPI YAML project download.');
  const text = await readFile(path, 'utf8');
  expect(text).not.toContain('raw-yaml-description');
  expect(JSON.parse(text).provenance).toContainEqual(expect.objectContaining({
    virtualPath: 'service.yaml', pointer: '/paths/~1entries~1{id}/get', relationship: 'Declared OpenAPI operation',
  }));
});

test('reviews same-file OpenAPI schema references with exact provenance and no external request', async ({ page }, info) => {
  const requested: string[] = [];
  await page.route('https://example.invalid/**', route => {
    requested.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Engineering file' });
  await dialog.getByRole('combobox', { name: 'OpenAPI view' }).selectOption('schemas');
  await dialog.getByLabel('OpenAPI specification').setInputFiles({
    name: 'models.yaml', mimeType: 'application/yaml', buffer: Buffer.from([
      'openapi: 3.1.0',
      'components:',
      '  schemas:',
      '    Account:',
      '      description: private-schema-description',
      '      properties:',
      '        customer/id:',
      '          $ref: "#/components/schemas/Customer"',
      '        remote:',
      '          $ref: https://example.invalid/private-schema.json',
      '    Customer:',
      '      allOf:',
      '        - $ref: "#/components/schemas/Account"',
      '    Audit:',
      '      type: object',
    ].join('\n')),
  });
  await dialog.getByLabel('Virtual path').fill('services/models.yaml');
  await dialog.getByRole('button', { name: 'Read schema facts' }).click();
  await expect(dialog.getByText(/2 resolved references · 1 unresolved reference/)).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Account', exact: true }).check();
  await dialog.getByRole('textbox', { name: 'Display label' }).fill('Account record');
  await dialog.getByRole('checkbox', { name: 'Customer', exact: true }).check();
  await dialog.getByLabel('Find schemas').fill('audit');
  await expect(dialog.getByRole('status')).toHaveText('2 selected · 2 selected outside visible rows · 2 selected references');
  await dialog.getByRole('button', { name: 'Preview diagram' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed OpenAPI schema diagram' })).toBeVisible();
  await expect(dialog.getByText('2 nodes · 2 connections · 1 schema omitted')).toBeVisible();
  await page.screenshot({ path: info.outputPath('openapi-schema-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('openapi-schema-mobile.png') });
  await dialog.getByRole('button', { name: 'Create new diagram' }).click();
  const live = page.getByRole('dialog', { name: 'OpenAPI schema relationships' });
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing OpenAPI schema project download.');
  const text = await readFile(path, 'utf8');
  const project = JSON.parse(text);
  expect(project.source).toContain('Account record');
  expect(project.provenance).toContainEqual(expect.objectContaining({
    adapter: 'openapi-schemas', virtualPath: 'services/models.yaml',
    pointer: '/components/schemas/Account/properties/customer~1id/$ref', relationship: 'Declared OpenAPI schema reference',
  }));
  expect(project.provenance).toContainEqual(expect.objectContaining({ pointer: '/components/schemas/Customer/allOf/0/$ref' }));
  expect(text).not.toMatch(/private-schema|example\.invalid|Audit/);
  expect(requested).toEqual([]);
});
