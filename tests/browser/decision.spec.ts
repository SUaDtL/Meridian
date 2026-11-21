import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

test('adds one decision and two explicitly chosen branches in a single reversible change', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  A[Start]\r\n  B[Existing destination]\r\n  A first@--> B\r\n  linkStyle 0 stroke:#123456\r\n';
  const project = { ...createDocument(), title: 'Decision review', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Decision review' }).click();
  const live = page.getByRole('dialog', { name: 'Decision review' });
  async function download() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing decision review project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const before = await download();
  await live.getByRole('button', { name: 'Commands' }).click();
  const commands = page.getByRole('dialog', { name: 'Commands' });
  await commands.getByRole('combobox').fill('add decision');
  await commands.getByRole('option', { name: /Add decision/ }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(edit.getByRole('combobox', { name: 'Operation' })).toHaveValue('addDecision');
  await edit.getByRole('textbox', { name: 'Decision label' }).fill('Can we continue');
  await edit.getByRole('combobox', { name: 'Connect from this node (optional)' }).selectOption({ label: 'Start (A)' });
  const existing = edit.getByRole('group', { name: 'Branch 1' });
  await existing.getByRole('textbox', { name: 'Connection label' }).fill('Proceed');
  await existing.getByRole('combobox', { name: 'Destination node' }).selectOption({ label: 'Existing destination (B)' });
  await expect(edit.getByRole('button', { name: 'Preview change' })).toBeDisabled();
  const newStep = edit.getByRole('group', { name: 'Branch 2' });
  await newStep.getByRole('textbox', { name: 'Connection label' }).fill('Review');
  await newStep.getByRole('combobox', { name: 'Destination type' }).selectOption('new');
  await newStep.getByRole('textbox', { name: 'New step label' }).fill('Ask for review');
  await edit.getByRole('button', { name: 'Preview change' }).click();
  const review = edit.getByRole('region', { name: 'Decision connections' });
  await expect(review).toContainText('Incoming connection from Start (A).');
  await expect(review).toContainText('Proceed → Existing destination (B)');
  await expect(review).toContainText('Review → Ask for review (new step)');
  const reorder = edit.getByRole('button', { name: 'Show second branch first' });
  await reorder.focus();
  await reorder.press('Space');
  await expect(reorder).toHaveAttribute('aria-pressed', 'true');
  await expect(reorder).toBeFocused();
  await expect(edit.getByRole('group', { name: /^Branch [12]$/ }).first()).toHaveAccessibleName('Branch 2');
  await expect(existing.getByRole('textbox', { name: 'Connection label' })).toHaveValue('Proceed');
  await expect(newStep.getByRole('textbox', { name: 'New step label' })).toHaveValue('Ask for review');
  await expect(review.getByRole('listitem')).toHaveText(['Review → Ask for review (new step)', 'Proceed → Existing destination (B)']);
  await expect(edit.getByRole('button', { name: 'Apply change' })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('decision-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('decision-mobile.png') });
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = await download();
  expect(after.source).toBe(source + [
    '  m_n1{"Can we continue"}', '  m_n2["Ask for review"]', '  A m_e1@--> m_n1',
    '  m_n1 m_e2@-->|"Proceed"| B', '  m_n1 m_e3@-->|"Review"| m_n2', '',
  ].join('\r\n'));
  expect(after.identity.elements).toEqual(expect.arrayContaining(before.identity.elements));
  expect(after.identity.elements).toHaveLength(before.identity.elements.length + 5);
  const decision = after.identity.elements.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'm_n1');
  expect(after.roles).toEqual([...before.roles, { elementId: decision.id, role: 'decision' }]);
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const restored = await download();
  expect(restored).toEqual({ ...before, revision: after.revision + 1, updatedAt: restored.updatedAt });
});
