import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function downloadProject(page: Page, live: Locator) {
  const [download] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await download.path();
  if (!path) throw new Error('Missing project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('adds one connected node with an explicit direction and role in one reversible edit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  const guidance = page.getByRole('dialog', { name: 'Build with guidance' });
  await guidance.getByLabel('Project title').fill('Add next workflow');
  await guidance.getByLabel('Put one step on each line').fill('Intake');
  await guidance.getByRole('button', { name: 'Review connections' }).click();
  await guidance.getByRole('button', { name: 'Preview process' }).click();
  await guidance.getByRole('button', { name: 'Create process' }).click();
  const live = page.getByRole('dialog', { name: 'Add next workflow' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Add next workflow' })).toBeVisible();
  const original = await downloadProject(page, live);

  await live.getByRole('button', { name: 'Edit flowchart', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await edit.getByRole('combobox', { name: 'Operation' }).selectOption('addNext');
  await edit.getByRole('combobox', { name: 'Connect to this node' }).selectOption({ label: 'Intake (m_n1)' });
  await edit.getByRole('combobox', { name: 'Shape' }).selectOption('diamond');
  await edit.getByRole('textbox', { name: 'Node label' }).fill('Decision');
  await edit.getByRole('textbox', { name: 'Connection label (optional)' }).fill('Needs review');
  await edit.getByRole('combobox', { name: 'Connection direction' }).selectOption('incoming');
  await edit.getByRole('combobox', { name: 'Node role' }).selectOption('service');
  const apply = edit.getByRole('button', { name: 'Apply change' });
  await expect(apply).toBeDisabled();
  await edit.getByRole('button', { name: 'Preview change' }).click();
  await expect(edit.getByRole('img', { name: 'Proposed diagram' })).toBeVisible();
  await apply.click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const project = await downloadProject(page, live);
  expect(project.revision).toBe(1);
  expect(project.source).toBe(original.source + '  m_n2{"Decision"}\n  m_n2 m_e1@-->|"Needs review"| m_n1\n');
  const node = project.identity.elements.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'm_n2');
  expect(project.roles).toEqual([{ elementId: node.id, role: 'service' }]);
  expect(project.identity.elements).toContainEqual(original.identity.elements[0]);

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await downloadProject(page, live);
  expect(restored.source).toBe(original.source);
  expect(restored.identity).toEqual(original.identity);
  expect(restored.roles).toEqual(original.roles);
});
