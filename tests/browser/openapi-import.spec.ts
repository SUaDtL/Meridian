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
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  const draftList = dialog.getByRole('list', { name: 'Saved OpenAPI scopes' });
  await draftList.getByRole('button', { name: /Resume OpenAPI schema relationships/ }).click();
  await expect(dialog.getByText('Saved schema scope restored. Preview it before creating a diagram.')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Account', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Customer', exact: true })).toBeChecked();
  await expect(dialog.getByRole('textbox', { name: 'Display label' }).first()).toHaveValue('Account record');
  const readDrafts = () => page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const open = indexedDB.open('meridian-workspace');
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('drafts');
      const read = tx.objectStore('drafts').getAll();
      tx.oncomplete = () => { db.close(); resolve(read.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
    open.onerror = () => reject(open.error);
  }));
  const drafts = await readDrafts();
  expect(drafts).toEqual([expect.objectContaining({ feature: 'engineering-facts',
    payload: expect.objectContaining({ adapter: 'openapi', title: 'OpenAPI schema relationships',
      selectedFactIds: ['s1', 's2'], selectedRelationshipIds: ['r1', 'r2'] }),
  })]);
  expect(JSON.stringify(drafts)).not.toMatch(/private-schema|example\.invalid/);
  await dialog.getByRole('button', { name: 'Preview diagram' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed OpenAPI schema diagram' })).toBeVisible();
  await expect(dialog.getByText('2 nodes · 2 connections · 1 schema omitted')).toBeVisible();
  await expect(dialog.getByText('0 unresolved placeholders included · 1 unresolved reference omitted from selected schemas.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to scope' }).click();
  await dialog.getByText('See unresolved locations', { exact: true }).click();
  await expect(dialog.getByText('services/models.yaml · /components/schemas/Account/properties/remote/$ref · Unsupported reference form')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Include labeled placeholders in the diagram' }).check();
  await dialog.getByRole('button', { name: 'Preview diagram' }).click();
  await expect(dialog.getByText('3 nodes · 3 connections · 1 schema omitted')).toBeVisible();
  await expect(dialog.getByText('1 unresolved placeholder included · 0 unresolved references omitted from selected schemas.')).toBeVisible();
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
  expect(project.source).toContain('Unresolved schema reference');
  expect(project.provenance).toContainEqual(expect.objectContaining({
    adapter: 'openapi-schemas', virtualPath: 'services/models.yaml',
    pointer: '/components/schemas/Account/properties/customer~1id/$ref', relationship: 'Declared OpenAPI schema reference',
  }));
  expect(project.provenance).toContainEqual(expect.objectContaining({ pointer: '/components/schemas/Customer/allOf/0/$ref' }));
  const unresolved = project.provenance.filter((item: { relationship: string }) => item.relationship.startsWith('Unresolved OpenAPI reference'));
  expect(unresolved).toHaveLength(2);
  expect(unresolved).toEqual(unresolved.map((item: { elementId: string }) => ({
    elementId: item.elementId, adapter: 'openapi-schemas', adapterVersion: '1.0.0', virtualPath: 'services/models.yaml',
    pointer: '/components/schemas/Account/properties/remote/$ref', relationship: 'Unresolved OpenAPI reference · Unsupported reference form',
  })));
  expect(text).not.toMatch(/private-schema|example\.invalid|Audit/);
  expect(requested).toEqual([]);
  expect(await readDrafts()).toEqual([]);
});

test('requires reviewed distinct virtual paths and retains provenance across supplied OpenAPI files', async ({ page }) => {
  const outgoing: string[] = [];
  await page.route('https://meridian-import.invalid/**', route => {
    outgoing.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Engineering file' });
  await dialog.getByRole('combobox', { name: 'OpenAPI view' }).selectOption('schemas');
  const pointer = '/components/schemas/Record';
  const first = { openapi: '3.1.0', components: { schemas: { Record: { $ref: `../shared/models.json#${pointer}` } } } };
  const second = { openapi: '3.1.0', components: { schemas: { Record: { $ref: `https://meridian-import.invalid/api/models.json#${pointer}` } } } };
  await dialog.getByLabel('OpenAPI specification').setInputFiles([first, second].map(spec => ({
    name: 'models.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(spec)),
  })));
  const read = dialog.getByRole('button', { name: 'Read schema facts' });
  await read.click();
  await expect(dialog.getByRole('alert')).toContainText('Assign a distinct virtual path');
  await dialog.getByRole('textbox', { name: 'Virtual path 1 for models.json' }).fill('api/models.json');
  await dialog.getByRole('textbox', { name: 'Virtual path 2 for models.json' }).fill('shared/models.json');
  await read.click();
  await expect(dialog.getByText(/2 supplied files · 2 schemas/)).toBeVisible();
  await expect(dialog.getByText(/2 resolved references · 0 unresolved references/)).toBeVisible();
  const scopes = ['api/models.json', 'shared/models.json'];
  for (const file of scopes) await dialog.getByRole('checkbox', { name: `Record · ${file}`, exact: true }).check();
  await dialog.getByRole('button', { name: 'Preview diagram' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed OpenAPI schema diagram' })).toBeVisible();
  await expect(dialog.getByText('2 nodes · 2 connections · 0 schemas omitted')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create new diagram' }).click();
  const live = page.getByRole('dialog', { name: 'OpenAPI schema relationships' });
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing multi-file OpenAPI project download.');
  const text = await readFile(path, 'utf8');
  const project = JSON.parse(text);
  for (const virtualPath of scopes) {
    expect(project.provenance).toContainEqual(expect.objectContaining({ virtualPath, pointer, relationship: 'Declared OpenAPI schema' }));
    expect(project.provenance).toContainEqual(expect.objectContaining({ virtualPath, pointer: pointer + '/$ref', relationship: 'Declared OpenAPI schema reference' }));
  }
  expect(text).not.toContain('meridian-import.invalid');
  expect(outgoing).toEqual([]);
});
