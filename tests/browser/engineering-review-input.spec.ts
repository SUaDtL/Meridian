import { expect, test, type Locator } from '@playwright/test';

const adapters = [
  {
    name: 'OpenAPI',
    dialog: 'Engineering file',
    input: 'OpenAPI specification',
    read: 'Read operation facts',
    filter: 'Find operations',
    selected: ['GET /intake', 'GET /archive'],
    search: 'archive',
    visible: 'GET /archive',
    preview: 'Preview diagram',
    proposed: 'Proposed OpenAPI operation diagram',
    create: 'Create new diagram',
    title: 'New diagram from file',
    scope: '2 selected · 1 selected outside visible rows · 1 matches',
    json: { openapi: '3.1.0', paths: { '/intake': { get: {} }, '/archive': { get: {} } } },
  },
  {
    name: 'JSON Schema',
    entry: 'Import JSON Schema',
    dialog: 'JSON Schema relationships',
    input: 'JSON Schema files',
    read: 'Read schema facts',
    filter: 'Find schema facts',
    selected: ['intake', 'archive'],
    search: 'archive',
    visible: 'archive',
    preview: 'Preview schema diagram',
    proposed: 'Proposed JSON Schema diagram',
    create: 'Create schema project',
    title: 'JSON Schema relationships',
    scope: '2 selected facts · 1 outside visible rows · 2 diagram nodes · 0 connections',
    json: { properties: { intake: { type: 'string' }, archive: { type: 'string' } } },
  },
  {
    name: 'Terraform',
    entry: 'Import Terraform JSON',
    dialog: 'Terraform inventory',
    input: 'Terraform JSON file',
    read: 'Read Terraform facts',
    filter: 'Find resources',
    selected: ['aws_a.intake', 'aws_b.archive'],
    search: 'archive',
    visible: 'aws_b.archive',
    preview: 'Preview inventory',
    proposed: 'Proposed Terraform inventory',
    create: 'Create inventory project',
    title: 'Terraform planned resource inventory',
    scope: '2 selected resources · 1 outside visible rows · 1 selected reference',
    option: 'Show declared references between selected resources',
    json: {
      format_version: '1.2',
      planned_values: { root_module: { resources: [{ address: 'aws_a.intake' }, { address: 'aws_b.archive' }] } },
      configuration: { root_module: { resources: [
        { address: 'aws_a.intake', expressions: { input: { references: ['aws_b.archive.id'] } } },
        { address: 'aws_b.archive' },
      ] } },
    },
  },
] as const;

for (const mode of ['keyboard', 'touch'] as const) {
  test.describe(mode, () => {
    if (mode === 'touch') test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

    for (const adapter of adapters) {
      test(`${adapter.name} keeps hidden selections through review and creation`, async ({ page }) => {
        const activate = (target: Locator, key = 'Enter') => mode === 'touch' ? target.tap() : target.press(key);
        await page.goto('/');
        await activate(page.getByRole('button', { name: 'Build with guidance' }));
        await activate(page.getByRole('button', { name: 'Engineering file' }));
        if ('entry' in adapter) await activate(page.getByRole('button', { name: adapter.entry }));
        const dialog = page.getByRole('dialog', { name: adapter.dialog });
        await dialog.getByLabel(adapter.input).setInputFiles({
          name: 'scope.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(adapter.json)),
        });
        await activate(dialog.getByRole('button', { name: adapter.read }));
        for (const name of adapter.selected) {
          const selection = dialog.getByRole('checkbox', { name, exact: true });
          await activate(selection, 'Space');
          await expect(selection).toBeChecked();
        }
        if ('option' in adapter) {
          const option = dialog.getByRole('checkbox', { name: adapter.option });
          await activate(option, 'Space');
          await expect(option).toBeChecked();
        }
        await dialog.getByLabel(adapter.filter).fill(adapter.search);
        await expect(dialog.getByRole('status')).toContainText(adapter.scope);
        await expect(dialog.getByRole('checkbox', { name: adapter.visible, exact: true })).toBeChecked();
        await expect(dialog.getByRole('checkbox', { name: adapter.selected[0], exact: true })).toHaveCount(0);
        await activate(dialog.getByRole('button', { name: adapter.preview }));
        await expect(dialog.getByRole('img', { name: adapter.proposed })).toBeVisible();
        await activate(dialog.getByRole('button', { name: adapter.create }));
        await activate(page.getByRole('button', { name: 'Authoring tools' }));
        const project = page.getByRole('dialog', { name: adapter.title, exact: true });
        await expect(project.getByRole('img', { name: `Diagram preview for ${adapter.title}` })).toBeVisible();
        await expect(project.getByText('Saved in this browser.')).toBeVisible();
      });
    }
  });
}
