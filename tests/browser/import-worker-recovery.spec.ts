import { expect, test } from '@playwright/test';

const cases = [
  {
    name: 'OpenAPI', entry: null, dialog: 'Engineering file', choose: 'OpenAPI specification',
    read: 'Read operation facts', preview: 'Preview diagram', timeout: 'Reading OpenAPI facts timed out.',
    malformed: '{"openapi":"3.1.0","openapi":"3.1.0","paths":{}}',
    valid: '{"openapi":"3.1.0","paths":{"/health":{"get":{"operationId":"GetHealth"}}}}', fact: 'GET /health',
  },
  {
    name: 'JSON Schema', entry: 'Import JSON Schema', dialog: 'JSON Schema relationships', choose: 'JSON Schema files',
    read: 'Read schema facts', preview: 'Preview schema diagram', timeout: 'Reading JSON Schema facts timed out.',
    malformed: '{"type":"object","type":"string"}',
    valid: '{"type":"object","properties":{"status":{"type":"string"}}}', fact: 'status',
  },
  {
    name: 'Terraform', entry: 'Import Terraform JSON', dialog: 'Terraform inventory', choose: 'Terraform JSON file',
    read: 'Read Terraform facts', preview: 'Preview inventory', timeout: 'Reading Terraform facts timed out.',
    malformed: '{"format_version":"1.0","format_version":"1.1"}',
    valid: '{"format_version":"1.1","values":{"root_module":{"resources":[{"address":"aws_a.health"}]}}}', fact: 'aws_a.health',
  },
] as const;

for (const fixture of cases) {
  test(`${fixture.name} discards malformed input and recovers in a new worker after a deadline`, async ({ page }) => {
    await page.addInitScript(() => {
      const post = Worker.prototype.postMessage;
      const terminate = Worker.prototype.terminate;
      let launches = 0;
      let held: Worker | undefined;
      Worker.prototype.postMessage = function (value, transfer) {
        if (value?.bytes instanceof ArrayBuffer || Array.isArray(value?.files)) {
          document.documentElement.dataset.importWorkerRequests = String(++launches);
          if (launches === 2) {
            held = this;
            return;
          }
        }
        Reflect.apply(post, this, transfer === undefined ? [value] : [value, transfer]);
      };
      Worker.prototype.terminate = function () {
        if (held === this) document.documentElement.dataset.importWorkerTimedOut = 'true';
        return terminate.call(this);
      };
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Build with guidance' }).click();
    await page.getByRole('button', { name: 'Engineering file' }).click();
    if (fixture.entry) await page.getByRole('button', { name: fixture.entry }).click();
    const dialog = page.getByRole('dialog', { name: fixture.dialog });
    const input = dialog.getByLabel(fixture.choose);
    const read = dialog.getByRole('button', { name: fixture.read });
    const file = (text: string) => ({ name: 'input.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await input.setInputFiles(file(fixture.malformed));
    await read.click();
    await expect(dialog.getByRole('alert')).toHaveText('The JSON contains a repeated object key.');
    await expect(dialog.getByRole('button', { name: fixture.preview })).toHaveCount(0);
    await input.setInputFiles(file(fixture.valid));
    await read.click();
    await expect(dialog.getByRole('alert')).toHaveText(fixture.timeout);
    await expect(page.locator('html')).toHaveAttribute('data-import-worker-timed-out', 'true');
    await expect(dialog.getByRole('button', { name: fixture.preview })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Retry with more time' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-import-worker-requests', '3');
    await expect(dialog.getByRole('checkbox', { name: new RegExp(fixture.fact.replaceAll('.', '\\.')) })).toBeVisible();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Manage projects' }).click();
    await page.getByRole('button', { name: 'Project migration and recovery' }).click();
    await expect(page.getByRole('button', { name: /Open v3 project/ })).toHaveCount(0);
  });
}
