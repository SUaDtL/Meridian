import { expect, test } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

test('checks the accepted drawing in a fixed viewing area without changing its source or revision', async ({ page }) => {
  const source = 'flowchart LR\n  A["Service"]\n  B["Service"]\n  C["Warehouse"]\n  A e1@--> B\n';
  const project = { ...createDocument(), title: 'Readability example', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Readability example' }).click();
  const live = page.getByRole('dialog', { name: 'Readability example' });
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  await check.getByRole('combobox', { name: 'Viewing profile' }).selectOption('custom');
  await check.getByRole('spinbutton', { name: 'Width in CSS pixels' }).fill('300');
  await check.getByRole('spinbutton', { name: 'Height in CSS pixels' }).fill('180');
  await check.getByRole('spinbutton', { name: 'Padding in CSS pixels' }).fill('10');
  await expect(check.getByText('300 × 180 CSS pixels · 10 pixels of padding · Project revision 0')).toBeVisible();
  await check.getByRole('button', { name: 'Check diagram' }).click();
  const report = check.getByRole('region', { name: 'Readability results' });
  await expect(report.getByText('Viewed label size · 3 measured · 0 unknown · 1 not applicable')).toBeVisible();
  await expect(report.getByText(/Service measures .* CSS pixels/).first()).toBeVisible();
  await expect(report.getByText(/2 distinct elements share the name Service/)).toBeVisible();
  await expect(report.getByText('The diagram contains 2 regions with no connection between them.')).toBeVisible();
  await check.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByText('Mermaid source', { exact: true }).click();
  expect(await live.locator('pre').textContent()).toBe(source);
  await expect(live.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
});
