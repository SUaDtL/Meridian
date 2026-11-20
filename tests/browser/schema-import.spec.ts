import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('maps supplied schema files, reviews references without fetching, and keeps exact local provenance', async ({ page }) => {
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
          pet: { $ref: '../models/common.json#Pet' },
          external: { $ref: 'https://schema.example/private.json' },
        },
        description: 'raw-schema-secret-fixture',
      })),
    },
    {
      name: 'common.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ $anchor: 'Pet', type: 'object' })),
    },
  ]);
  await dialog.getByRole('button', { name: 'Read schema facts' }).click();
  await expect(dialog.getByRole('alert')).toContainText('distinct virtual path');
  await dialog.getByLabel('Virtual path for file 1').fill('api/common.json');
  await dialog.getByLabel('Virtual path for file 2').fill('models/common.json');
  await dialog.getByRole('button', { name: 'Read schema facts' }).click();
  await expect(dialog.getByText('2 ordinary references checked · 1 unresolved entry · 0 locations with composition or conditionals')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'api/common.json', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'pet', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'models/common.json', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'external', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Include labeled placeholders in the diagram' }).check();
  await dialog.getByLabel('Find schema facts').fill('external');
  await expect(dialog.getByRole('status')).toContainText('3 outside visible rows');
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
  expect(contents).not.toMatch(/raw-schema-secret|schema\.example/);
  expect(remoteRequests).toEqual([]);
});
