import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

test('inserts a reviewed component and attachment as one source-preserving project change', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  m_n1[Intake]\r\n  End[Finish]\r\n  %% Keep the existing source\r\n  m_n1 m_e1@--> End\r\n';
  const manual = { ...createScene(), title: 'Original scene', visible: ['node:m_n1', 'node:End', 'edge:id:m_e1'] };
  const project = { ...createDocument(), title: 'Insertion example', source,
    storyboard: { version: 1 as const, scenes: [manual], loop: false } };
  project.design.elements['node:m_n1'] = { fill: '#abcdef' };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Insertion example' }).click();
  const live = page.getByRole('dialog', { name: 'Insertion example' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Insertion example' })).toBeVisible();
  async function download() {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing project download.');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  const original = await download();
  await live.getByRole('button', { name: 'Commands', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Commands' }).getByRole('combobox');
  await search.fill('Insert component');
  await search.press('Enter');
  const component = page.getByRole('dialog', { name: 'Insert component' });
  await component.getByRole('button', { name: /API, queue, and worker/ }).click();
  const preview = component.getByRole('button', { name: 'Preview component' });
  await expect(preview).toBeDisabled();
  await component.getByLabel('Find attachment nodes').fill('Intake');
  await component.getByRole('group', { name: 'Request input' }).getByRole('combobox', { name: 'Attachment target' })
    .selectOption({ label: 'Intake (m_n1)' });
  await expect(preview).toBeDisabled();
  await component.getByRole('group', { name: 'Worker result' }).getByRole('combobox', { name: 'Attachment target' })
    .selectOption({ label: 'Leave unconnected' });
  await preview.click();
  await expect(component.getByRole('img', { name: 'Proposed component diagram' })).toBeVisible();
  const attachments = component.getByRole('list', { name: 'Reviewed attachments' });
  await expect(attachments).toContainText('Request input · From Intake (m_n1)');
  await expect(attachments).toContainText('Worker result · Leave unconnected');
  await page.screenshot({ path: info.outputPath('component-insert-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('component-insert-mobile.png') });
  await component.getByRole('button', { name: 'Insert reviewed component' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const inserted = await download();
  expect(inserted.source).toBe(source + '  m_n2["API"]\r\n  m_n3[("Work queue")]\r\n  m_n4["Worker"]\r\n'
    + '  m_n2 m_e2@-->|"Enqueue"| m_n3\r\n  m_n3 m_e3@-->|"Consume"| m_n4\r\n  m_n1 m_e4@--> m_n2\r\n');
  expect(inserted.identity.elements.slice(0, original.identity.elements.length)).toEqual(original.identity.elements);
  expect(inserted.storyboard).toEqual(original.storyboard);
  expect(inserted.design).toEqual(original.design);
  expect(inserted.componentInstances).toHaveLength(1);
  expect(inserted.componentInstances[0].bindings.map((item: { localId: string }) => item.localId)).toEqual(['api', 'queue', 'worker', 'enqueue', 'consume']);
  expect(inserted.roles.map((item: { role: string }) => item.role)).toEqual(['service', 'queue', 'service']);

  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const undone = await download();
  expect(undone).toEqual({ ...original, revision: inserted.revision + 1, updatedAt: undone.updatedAt });
});
