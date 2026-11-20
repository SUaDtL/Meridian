import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('creates a reviewed Terraform import with declared references and address-only provenance', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Engineering file' }).click();
  await page.getByRole('button', { name: 'Import Terraform JSON' }).click();
  const dialog = page.getByRole('dialog', { name: 'Terraform inventory' });
  await dialog.getByLabel('Terraform JSON file').setInputFiles({
    name: 'plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      format_version: '1.2',
      planned_values: { root_module: { resources: [
        { address: 'aws_a.app', values: { password: 'private-test-password' } },
        { address: 'aws_b.data' },
      ] }, outputs: { secret: { value: 'private-test-output' } } },
      configuration: { root_module: { resources: [
        { address: 'aws_a.app', expressions: { database: { references: ['aws_b.data.id'] }, secret: { constant_value: 'private-test-constant' } } },
        { address: 'aws_b.data' },
      ] } },
    })),
  });
  await dialog.getByRole('button', { name: 'Read Terraform facts' }).click();
  await dialog.getByRole('checkbox', { name: 'aws_a.app', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'aws_b.data', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Show declared references between selected resources' }).check();
  await expect(dialog.getByRole('status')).toHaveText('2 selected resources · 0 outside visible rows · 1 selected reference');
  await dialog.getByRole('button', { name: 'Preview inventory' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed Terraform inventory' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Create inventory project' }).click();
  const live = page.getByRole('dialog', { name: 'Terraform planned resource inventory' });
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing project download.');
  const body = await readFile(path, 'utf8');
  const project = JSON.parse(body);
  expect(project.source).toContain('Declared reference');
  expect(project.provenance).toContainEqual(expect.objectContaining({
    virtualPath: 'plan.json', pointer: '/configuration/root_module/resources/0/expressions/database/references/0',
    relationship: 'Declared Terraform configuration reference',
  }));
  expect(body).not.toContain('private-test-');
});
