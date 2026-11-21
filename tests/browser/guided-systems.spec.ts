import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

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
  const resume = dialog.getByRole('button', { name: /Resume Reviewed system map/ });
  await expect(resume.locator('time')).toHaveCount(2);
  const dates = await resume.locator('time').evaluateAll(times => times.map(time => time.getAttribute('datetime')));
  expect(dates).toHaveLength(2);
  expect(Date.parse(dates[1]!) - Date.parse(dates[0]!)).toBe(7 * 24 * 60 * 60 * 1_000);
  await resume.click();
  const restored = dialog.getByRole('status').filter({ hasText: 'Draft saved locally at' });
  await expect(restored).toContainText(/Draft saved locally at .* · expires /);
  for (const [index, date] of dates.entries()) await expect(restored.locator('time').nth(index)).toHaveAttribute('datetime', date!);
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

test('exports a normalized unsaved systems draft without creating a project', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'drafts') throw new DOMException('Draft storage is full.', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await page.goto('/');
  const dialog = await openSystems(page);
  await dialog.getByLabel('Project title').fill('Unsaved systems');
  await dialog.getByRole('button', { name: 'Add system', exact: true }).click();
  await dialog.getByRole('group', { name: 'System 1' }).getByRole('textbox', { name: 'Label' }).fill('  Intake  ');
  await dialog.getByRole('group', { name: 'System 1' }).getByRole('combobox', { name: 'Role' }).selectOption('service');
  await dialog.getByRole('button', { name: 'Review relationships' }).click();
  await dialog.getByRole('button', { name: 'Save systems draft' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Draft storage is full.');
  await expect(dialog.getByRole('status')).toHaveText('Session-only changes');
  const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'Download normalized draft' }).click()]);
  expect(file.suggestedFilename()).toBe('systems.meridian-draft.json');
  const path = await file.path();
  if (!path) throw new Error('Missing normalized systems draft.');
  const record = JSON.parse(await readFile(path, 'utf8'));
  expect(record).toMatchObject({ schema: 'meridian-draft/v1', feature: 'guided', baseToken: null, payload: {
    title: 'Unsaved systems', intent: 'systems', mode: 'connections',
    nodes: [{ label: '  Intake  ', role: 'service', shape: 'rect', sourceRow: null }], edges: [],
  } });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('region', { name: 'Continue working' })).toHaveCount(0);
});

test('keeps reviewed systems and their attachment when another tab changes the insertion target', async ({ page }) => {
  const source = '\uFEFFflowchart LR\r\n  A[Intake]\r\n  B[Archive]\r\n  A original@--> B\r\n';
  const project = { ...createDocument(), title: 'Guided insertion target', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });
  async function openTarget(tab: Page, prepare: boolean) {
    await tab.goto('/');
    await tab.getByRole('button', { name: 'Manage projects' }).click();
    await tab.getByRole('button', { name: 'Project migration and recovery' }).click();
    if (prepare) await tab.getByRole('button', { name: 'Prepare v3 copies' }).click();
    await tab.getByRole('button', { name: 'Open v3 project Guided insertion target' }).click();
    const live = tab.getByRole('dialog', { name: project.title, exact: true });
    await expect(live.getByRole('img', { name: /Diagram preview for/ })).toBeVisible();
    return live;
  }

  const original = await openTarget(page, true);
  const before = await downloadProject(page, original);
  await original.getByRole('button', { name: 'Insert systems diagram', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: 'Build a systems diagram' });
  await wizard.getByRole('button', { name: 'Add system', exact: true }).click();
  await wizard.getByRole('button', { name: 'Add system', exact: true }).click();
  const gateway = wizard.getByRole('group', { name: 'System 1' });
  await gateway.getByRole('textbox', { name: 'Label' }).fill('Gateway');
  await gateway.getByRole('combobox', { name: 'Role' }).selectOption('service');
  const queue = wizard.getByRole('group', { name: 'System 2' });
  await queue.getByRole('textbox', { name: 'Label' }).fill('Work queue');
  await queue.getByRole('combobox', { name: 'Role' }).selectOption('queue');
  await wizard.getByRole('button', { name: 'Review relationships' }).click();
  await wizard.getByRole('button', { name: 'Add relationship' }).click();
  const relationship = wizard.getByRole('group', { name: 'Relationship 1' });
  await relationship.getByRole('combobox', { name: 'From' }).selectOption({ label: 'Gateway (1)' });
  await relationship.getByRole('combobox', { name: 'To' }).selectOption({ label: 'Work queue (2)' });
  await relationship.getByRole('textbox', { name: 'Relationship label' }).fill('Queues work');
  const attach = wizard.getByRole('group', { name: 'Attachment to this project' });
  await attach.getByRole('combobox', { name: 'Existing node' }).selectOption({ label: 'Intake (A)' });
  await attach.getByRole('combobox', { name: 'Draft node' }).selectOption({ label: 'Gateway (1)' });
  await attach.getByRole('combobox', { name: 'Attachment direction' }).selectOption('from-existing');
  const preview = wizard.getByRole('button', { name: 'Preview systems diagram' });
  const apply = wizard.getByRole('button', { name: 'Insert reviewed systems' });
  await preview.click();
  await expect(wizard.getByText('Attachment Intake (A) → Gateway (1)', { exact: true })).toBeVisible();
  await expect(apply).toBeEnabled();

  const second = await page.context().newPage();
  try {
    const otherEditor = await openTarget(second, false);
    await otherEditor.getByRole('button', { name: 'Edit heading' }).click();
    const heading = second.getByRole('dialog', { name: 'Edit heading' });
    await heading.getByRole('textbox', { name: 'Title', exact: true }).fill('Updated insertion target');
    await heading.getByRole('button', { name: 'Apply heading' }).click();
    const updated = second.getByRole('dialog', { name: 'Updated insertion target', exact: true });
    await expect(updated.getByText('Saved in this browser.')).toBeVisible();
    const changed = await downloadProject(second, updated);
    expect(changed.source).toBe(source);

    await apply.click();
    await expect(wizard.getByRole('alert')).toContainText('The saved project changed.');
    await expect(attach.getByRole('combobox', { name: 'Attachment direction' })).toHaveValue('from-existing');
    await expect(attach.getByRole('combobox', { name: 'Existing node' }).locator('option:checked')).toHaveText('Intake (A)');
    await expect(relationship.getByRole('textbox', { name: 'Relationship label' })).toHaveValue('Queues work');
    expect(await downloadProject(second, updated)).toEqual(changed);

    await preview.click();
    await expect(wizard.getByText(/Insert into Updated insertion target with 2 systems/)).toBeVisible();
    await apply.click();
    const live = page.getByRole('dialog', { name: 'Updated insertion target', exact: true });
    await expect(live.getByText('Saved in this browser.')).toBeVisible();
    const accepted = await downloadProject(page, live);
    expect(accepted.source).toBe(source + '  m_n1["Gateway"]\r\n  m_n2["Work queue"]\r\n'
      + '  m_n1 m_e1@-->|"Queues work"| m_n2\r\n  A m_e2@--> m_n1\r\n');
    expect(accepted.identity.elements.slice(0, before.identity.elements.length)).toEqual(before.identity.elements);
    expect(accepted.roles.map((item: { role: string }) => item.role)).toEqual(['service', 'queue']);
    expect(accepted.componentInstances).toEqual(before.componentInstances);
    await live.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(live.getByText('Saved in this browser.')).toBeVisible();
    const restored = await downloadProject(page, live);
    expect(restored).toEqual({ ...changed, revision: accepted.revision + 1, updatedAt: restored.updatedAt });
  } finally { await second.close(); }
});
