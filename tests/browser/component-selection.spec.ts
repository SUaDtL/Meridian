import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing component selection download.');
  return readFile(path, 'utf8');
}

test('saves exactly the reviewed nodes, one internal edge, and one port without editing the source project', async ({ page }, info) => {
  const source = 'flowchart LR\n Client[Outside client]\n A[(Queue)]\n B[Worker]\n Archive[Outside archive]\n Client entry@--> A\n A route@-->|"Route work"| B\n B exit@--> Archive\n';
  const project = { ...createDocument(), title: 'Extraction example', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Extraction example' }).click();
  const projectDialog = page.getByRole('dialog', { name: 'Extraction example' });
  await expect(projectDialog.getByRole('img', { name: 'Diagram preview for Extraction example' })).toBeVisible();
  const button = projectDialog.getByRole('button', { name: 'Download v3 project' });
  const before = await download(page, button);
  await projectDialog.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Queue/ }).click();
  await outline.getByRole('treeitem', { name: /^Worker/ }).click({ modifiers: ['Shift'] });
  await outline.getByRole('textbox', { name: 'Find an element' }).fill('Queue');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await outline.getByRole('button', { name: 'Save as component', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Save selection as component' });
  await expect(review.getByText('2 selected nodes · 1 hidden in the outline')).toBeVisible();
  await review.getByLabel('Component name').fill('Reusable queue worker');
  await review.getByRole('checkbox', { name: /Make Worker/ }).check();
  await review.getByRole('checkbox', { name: /Include Queue → Worker/ }).check();
  await review.getByRole('checkbox', { name: /Expose Outside client → Queue/ }).check();
  await review.getByLabel('Port label').fill('Work input');
  await review.getByRole('button', { name: 'Preview component' }).click();
  await expect(review.getByRole('img', { name: 'Proposed reusable component' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('save-component-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('save-component-mobile.png') });
  const content = await download(page, review.getByRole('button', { name: 'Download component' }));
  expect(content).not.toMatch(/Outside client|Outside archive|Extraction example/);
  const result = JSON.parse(content);
  expect(result.fragment.nodes).toEqual([
    { id: 'node-1', label: 'Queue', shape: 'cylinder', role: null },
    { id: 'node-2', label: 'Worker', shape: 'rect', role: null },
  ]);
  expect(result.fragment.edges).toEqual([{ id: 'edge-1', sourceId: 'node-1', targetId: 'node-2', label: 'Route work', direction: 'forward' }]);
  expect(result.parameters).toEqual([expect.objectContaining({ id: 'label-node-2', default: 'Worker' })]);
  expect(result.ports).toEqual([{ id: 'port-1', nodeId: 'node-1', label: 'Work input', direction: 'in' }]);
  await review.getByRole('button', { name: 'Save to component library' }).click();
  await expect(review.getByRole('status')).toContainText('Component saved in this browser.');
  await review.getByRole('button', { name: 'Close dialog' }).click();
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  expect(await download(page, button)).toBe(before);
  await expect(projectDialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();

  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Browse components' }).click();
  const shelf = page.getByRole('dialog', { name: 'Components' });
  await shelf.getByLabel('Search components').fill('Reusable queue worker');
  await expect(shelf.getByRole('button', { name: /Reusable queue worker/ })).toBeVisible();
});
