import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function openSystems(page: Page) {
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Systems and relationships' }).click();
  await page.getByRole('button', { name: 'Enter systems manually' }).click();
  return page.getByRole('dialog', { name: 'Build a systems diagram' });
}

async function downloadProject(page: Page, panel: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing guided systems project.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('keeps duplicate systems distinct, resumes explicit directions, and creates a portable project', async ({ page }, info) => {
  await page.goto('/');
  let dialog = await openSystems(page);
  await dialog.getByLabel('Project title').fill('Reviewed system map');
  await dialog.getByRole('button', { name: 'Add system', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add system', exact: true }).click();
  const first = dialog.getByRole('group', { name: 'System 1' });
  const second = dialog.getByRole('group', { name: 'System 2' });
  await first.getByRole('textbox', { name: 'Label' }).fill('Service');
  await first.getByRole('combobox', { name: 'Role' }).selectOption('service');
  await first.getByRole('combobox', { name: 'Shape' }).selectOption('rounded');
  await second.getByRole('textbox', { name: 'Label' }).fill('Service');
  await second.getByRole('combobox', { name: 'Role' }).selectOption('database');
  await dialog.getByRole('button', { name: 'Review relationships' }).click();
  await dialog.getByRole('button', { name: 'Add relationship' }).click();
  await dialog.getByRole('button', { name: 'Preview systems diagram' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Choose valid endpoints');
  const link = dialog.getByRole('group', { name: 'Relationship 1' });
  await link.getByRole('combobox', { name: 'From' }).selectOption({ label: 'Service (1)' });
  await link.getByRole('combobox', { name: 'To' }).selectOption({ label: 'Service (2)' });
  await link.getByRole('textbox', { name: 'Relationship label' }).fill('Shares data');
  await link.getByRole('combobox', { name: 'Direction' }).selectOption('both');
  await dialog.getByRole('button', { name: 'Add relationship' }).click();
  const neutral = dialog.getByRole('group', { name: 'Relationship 2' });
  await neutral.getByRole('combobox', { name: 'From' }).selectOption({ label: 'Service (2)' });
  await neutral.getByRole('combobox', { name: 'To' }).selectOption({ label: 'Service (1)' });
  await neutral.getByRole('combobox', { name: 'Direction' }).selectOption('none');
  await dialog.getByRole('button', { name: 'Save systems draft' }).click();
  await expect(dialog.getByRole('status')).toContainText('Draft saved locally');
  await page.reload();
  dialog = await openSystems(page);
  await dialog.getByRole('button', { name: /Resume Reviewed system map/ }).click();
  await dialog.getByRole('button', { name: 'Review relationships' }).click();
  await expect(link.getByRole('combobox', { name: 'Direction' })).toHaveValue('both');
  await expect(neutral.getByRole('combobox', { name: 'Direction' })).toHaveValue('none');
  await dialog.getByRole('button', { name: 'Preview systems diagram' }).click();
  await expect(dialog.getByRole('img', { name: 'Proposed systems diagram' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('systems-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('systems-review-mobile.png') });
  await dialog.getByRole('button', { name: 'Create systems project' }).click();
  const live = page.getByRole('dialog', { name: 'Reviewed system map' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Reviewed system map' })).toBeVisible();
  const project = await downloadProject(page, live);
  expect(project.source).toBe('flowchart LR\n  m_n1("Service")\n  m_n2["Service"]\n  m_n1 m_e1@<-->|"Shares data"| m_n2\n  m_n2 m_e2@--- m_n1\n');
  const bindings = new Map(project.identity.elements.map((item: { binding: { sourceId: string }; id: string }) => [item.binding.sourceId, item.id]));
  expect(bindings.get('m_n1')).not.toBe(bindings.get('m_n2'));
  expect(project.roles).toEqual([
    { elementId: bindings.get('m_n1'), role: 'service' },
    { elementId: bindings.get('m_n2'), role: 'database' },
  ]);
});
