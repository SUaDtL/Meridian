import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('resumes schema facts without source bytes and creates exact local provenance', async ({ page }) => {
  const remoteRequests: string[] = [];
  await page.context().route(/schema\.example/, route => {
    remoteRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  await page.getByRole('button', { name: 'Import JSON Schema' }).click();
  const dialog = page.getByRole('dialog', { name: 'JSON Schema relationships' });
  await dialog.getByLabel('JSON Schema files').setInputFiles([
    {
      name: 'common.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        required: ['pet'], properties: {
          pet: { $ref: '../models/common.json#/$defs/NestedPet' },
          secondPet: { $ref: 'https://schema.example/types/pet.json#Pet' },
          external: { $ref: 'https://schema.example/private.json' },
        },
        description: 'raw-schema-secret-fixture',
      })),
    },
    {
      name: 'common.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        $id: 'https://schema.example/root.json',
        $defs: { NestedPet: { $id: 'types/pet.json', $anchor: 'Pet', type: 'object' } },
      })),
    },
  ]);
  await dialog.getByRole('button', { name: 'Read schema facts' }).click();
  await expect(dialog.getByRole('alert')).toContainText('distinct virtual path');
  await dialog.getByLabel('Virtual path for file 1').fill('api/common.json');
  await dialog.getByLabel('Virtual path for file 2').fill('models/common.json');
  await dialog.getByRole('button', { name: 'Read schema facts' }).click();
  await expect(dialog.getByText('3 ordinary references checked · 1 unresolved entry · 0 locations with composition or conditionals')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'api/common.json', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'pet', exact: true }).check();
  await dialog.getByLabel('Diagram label').nth(1).fill('Pet field');
  await dialog.getByRole('checkbox', { name: 'NestedPet', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'secondPet', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'external', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Include labeled placeholders in the diagram' }).check();
  await dialog.getByLabel('Find schema facts').fill('external');
  await expect(dialog.getByRole('status')).toContainText('4 outside visible rows');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();
  const records = () => page.evaluate(async () => new Promise<unknown[]>((resolve, reject) => {
    const opening = indexedDB.open('meridian-workspace');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction('drafts', 'readonly');
      const request = tx.objectStore('drafts').getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    };
  }));
  const saved = await records();
  expect(saved).toHaveLength(1);
  expect(JSON.stringify(saved)).toContain('Pet field');
  expect(JSON.stringify(saved)).not.toMatch(/raw-schema-secret|schema\.example/);
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  await page.getByRole('button', { name: 'Import JSON Schema' }).click();
  await dialog.getByRole('button', { name: /Resume api\/common\.json/ }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Pet field', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Include labeled placeholders in the diagram' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Preview schema diagram' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed JSON Schema diagram' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Create schema project' }).click();
  const live = page.getByRole('dialog', { name: 'JSON Schema relationships' });
  await expect(live.getByRole('img', { name: 'Diagram preview for JSON Schema relationships' })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await download.path();
  if (!path) throw new Error('Missing JSON Schema project download.');
  const contents = await readFile(path, 'utf8');
  const { provenance } = JSON.parse(contents);
  expect(provenance).toContainEqual(expect.objectContaining({
    adapter: 'json-schema', virtualPath: 'api/common.json', pointer: '/properties/pet/$ref',
    relationship: 'Declared schema reference',
  }));
  expect(provenance).toContainEqual(expect.objectContaining({
    virtualPath: 'api/common.json', pointer: '/properties/pet', relationship: 'Declared required property',
  }));
  expect(provenance).toContainEqual(expect.objectContaining({
    virtualPath: 'api/common.json', pointer: '/properties/secondPet/$ref', relationship: 'Declared schema reference',
  }));
  expect(provenance.filter((item: { virtualPath: string; pointer: string }) => (
    item.virtualPath === 'models/common.json' && item.pointer === '/$defs/NestedPet'
  ))).toHaveLength(1);
  expect(contents).not.toMatch(/raw-schema-secret|schema\.example/);
  expect(await records()).toHaveLength(0);
  expect(remoteRequests).toEqual([]);
});

test('explains an unsupported JSON Schema dialect and recovers with a dynamic reference report', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  await page.getByRole('button', { name: 'Import JSON Schema' }).click();
  const dialog = page.getByRole('dialog', { name: 'JSON Schema relationships' });
  const file = dialog.getByLabel('JSON Schema files');
  const read = dialog.getByRole('button', { name: 'Read schema facts' });
  const fixture = (schema: object) => ({ name: 'dialect.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(schema)) });
  await file.setInputFiles(fixture({ $schema: 'http://json-schema.org/draft-07/schema#', type: 'object' }));
  await read.click();
  await expect(dialog.getByRole('alert')).toHaveText('Choose JSON Schema draft 2020-12. A supplied schema declares a different dialect.');
  await expect(dialog.getByRole('button', { name: 'Preview schema diagram' })).toHaveCount(0);
  await file.setInputFiles(fixture({ $schema: 'https://json-schema.org/draft/2020-12/schema', properties: { child: { $dynamicRef: '#Child' } } }));
  await read.click();
  await expect(dialog.getByText(/0 ordinary references checked · 1 unresolved entry/)).toBeVisible();
  await expect(dialog.getByText(/dynamic reference semantics are outside this view/)).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});
