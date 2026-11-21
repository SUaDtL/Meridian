import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing component selection download.');
  return readFile(path, 'utf8');
}

test('saves exactly the reviewed nodes, connection directions, and port without editing the source project', async ({ page }, info) => {
  const source = 'flowchart LR\n Client[Outside client]\n A[(Queue)]\n B[Worker]\n Archive[Outside archive]\n Client entry@--> A\n A route@<-->|"Route work"| B\n A note@---|"Shares capacity"| B\n B exit@--> Archive\n';
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
  const review = page.getByRole('dialog', { name: 'Save selection as component' });
  await outline.getByRole('treeitem', { name: /^Queue/ }).click();
  await outline.getByRole('button', { name: 'Save as component', exact: true }).click();
  await expect(review.getByRole('alert')).toContainText('The boundary connection Queue ↔ Worker');
  await review.getByRole('button', { name: 'Close dialog' }).click();
  await outline.getByRole('treeitem', { name: /^Worker/ }).click({ modifiers: ['Shift'] });
  await outline.getByRole('textbox', { name: 'Find an element' }).fill('Queue');
  await expect(outline.getByRole('status')).toHaveText('2 selected · 1 hidden');
  await outline.getByRole('button', { name: 'Save as component', exact: true }).click();
  await expect(review.getByText('2 selected nodes · 1 hidden in the outline')).toBeVisible();
  await review.getByLabel('Component name').fill('Reusable queue worker');
  await review.getByRole('checkbox', { name: /Make Worker/ }).check();
  await review.getByRole('checkbox', { name: /Include Queue ↔ Worker/ }).check();
  await review.getByRole('checkbox', { name: /Include Queue – Worker/ }).check();
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
  expect(result.fragment.edges).toEqual([
    { id: 'edge-1', sourceId: 'node-1', targetId: 'node-2', label: 'Route work', direction: 'both' },
    { id: 'edge-2', sourceId: 'node-1', targetId: 'node-2', label: 'Shares capacity', direction: 'none' },
  ]);
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
  await expect(shelf.getByRole('button', { name: /^Reusable queue worker/ })).toBeVisible();
});

test('extracts reviewed groups and keeps contextual ancestors free of unselected siblings', async ({ page }) => {
  const source = 'flowchart LR\n  subgraph Outer [Service boundary]\n    A[Outside sibling]\n    subgraph Inner [Worker boundary]\n      B[Receive]\n      C[Process]\n    end\n  end\n  D[Exit]\n  B inside@--> C\n  C outside@--> D\n';
  const project = { ...createDocument(), title: 'Grouped extraction example', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Grouped extraction example' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  const before = await download(page, live.getByRole('button', { name: 'Download v3 project' }));
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  const review = page.getByRole('dialog', { name: 'Save selection as component' });
  await outline.getByRole('treeitem', { name: /^Worker boundary/ }).click();
  await outline.getByRole('textbox', { name: 'Find an element' }).fill('Outside sibling');
  await expect(outline.getByRole('status')).toHaveText('1 selected · 1 hidden');
  await outline.getByRole('button', { name: 'Save as component', exact: true }).click();
  await expect(review.getByText('1 selected · 1 hidden in the outline · 2 nodes and 2 groups included')).toBeVisible();
  await review.getByRole('textbox', { name: 'Component name' }).fill('Worker group');
  await review.getByRole('checkbox', { name: /Include Receive → Process/ }).check();
  await review.getByRole('button', { name: 'Preview component' }).click();
  const selected = JSON.parse(await download(page, review.getByRole('button', { name: 'Download component' })));
  const outer = selected.fragment.groups.find((item: { label: string }) => item.label === 'Service boundary');
  const inner = selected.fragment.groups.find((item: { label: string }) => item.label === 'Worker boundary');
  expect(outer.members).toEqual([inner.id]);
  expect(inner.parentId).toBe(outer.id);
  expect(selected.fragment.nodes.map((item: { label: string }) => item.label)).toEqual(['Receive', 'Process']);
  expect(selected.fragment.edges).toHaveLength(1);
  expect(selected.ports).toHaveLength(0);
  await review.getByRole('button', { name: 'Close dialog' }).click();
  await outline.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await outline.getByRole('textbox', { name: 'Find an element' }).fill('Receive');
  await outline.getByRole('treeitem', { name: /^Receive/ }).click();
  await outline.getByRole('button', { name: 'Save as component', exact: true }).click();
  await expect(review.getByText('1 selected · 0 hidden in the outline · 1 node and 2 groups included')).toBeVisible();
  await review.getByRole('textbox', { name: 'Component name' }).fill('Receive only');
  await review.getByRole('button', { name: 'Preview component' }).click();
  const one = JSON.parse(await download(page, review.getByRole('button', { name: 'Download component' })));
  expect(one.fragment.nodes.map((item: { label: string }) => item.label)).toEqual(['Receive']);
  expect(one.fragment.groups).toHaveLength(2);
  expect(one.fragment.edges).toEqual([]);
  await review.getByRole('button', { name: 'Close dialog' }).click();
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  expect(await download(page, live.getByRole('button', { name: 'Download v3 project' }))).toBe(before);
});

test('links the unsupported reference that blocks component extraction and preserves exact source', async ({ page }) => {
  const reference = 'click A "https://example.invalid/reference"';
  const source = `flowchart LR\r\n  A["Worker"]\r\n  B["Queue"]\r\n  ${reference}\r\n  A work@--> B\r\n`;
  const project = { ...createDocument(), title: 'Unsupported component reference', source };
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({
    version: 2, activeId: project.id, documents: [project],
  })), { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Unsupported component reference' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  await expect(live.getByRole('img', { name: `Diagram preview for ${project.title}` })).toBeVisible();
  const projectFile = live.getByRole('button', { name: 'Download v3 project' });
  const before = await download(page, projectFile);
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Worker/ }).click();
  const save = outline.getByRole('button', { name: 'Save as component' });
  await expect(save).toBeDisabled();
  await expect(save).toHaveAccessibleDescription('Component definitions do not include click links or callbacks. Review line 4.');
  await outline.getByRole('button', { name: 'Open blocking statement in source' }).press('Enter');
  await expect(live.locator('mark')).toHaveText(reference);
  await expect(live.locator('mark')).toBeFocused();
  await live.getByRole('button', { name: 'Return to Outline' }).click();
  await expect(outline.getByRole('treeitem', { name: /^Worker/ })).toHaveAttribute('aria-selected', 'true');
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  expect(await download(page, projectFile)).toBe(before);
});

test('keeps the reviewed component downloadable after an IndexedDB quota failure', async ({ page }) => {
  const project = { ...createDocument(), title: 'Quota component example', source: 'flowchart LR\n A[Worker]\n' };
  await page.addInitScript(({ key, project }) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }));
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (value, key) {
      if (this.name === 'library') throw new DOMException('Fixture quota reached', 'QuotaExceededError');
      return add.call(this, value, key);
    };
  }, { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Quota component example' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  const projectFile = live.getByRole('button', { name: 'Download v3 project' });
  const original = await download(page, projectFile);
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Worker/ }).click();
  await outline.getByRole('button', { name: 'Save as component' }).click();
  const review = page.getByRole('dialog', { name: 'Save selection as component' });
  await review.getByRole('textbox', { name: 'Component name' }).fill('Quota review worker');
  await review.getByRole('button', { name: 'Preview component' }).click();
  const componentFile = review.getByRole('button', { name: 'Download component' });
  const reviewed = await download(page, componentFile);
  await review.getByRole('button', { name: 'Save to component library' }).click();
  await expect(review.getByRole('alert')).toHaveText('Browser storage is full. Download the reviewed component to keep it.');
  await expect(review.getByText('Component saved in this browser.')).toHaveCount(0);
  expect(await download(page, componentFile)).toBe(reviewed);
  expect(JSON.parse(reviewed).fragment.nodes).toEqual([{ id: 'node-1', label: 'Worker', shape: 'rect', role: null }]);
  await review.getByRole('button', { name: 'Close dialog' }).click();
  await outline.getByRole('button', { name: 'Close dialog' }).click();
  expect(await download(page, projectFile)).toBe(original);
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Browse components' }).click();
  const shelf = page.getByRole('dialog', { name: 'Components' });
  await shelf.getByLabel('Search components').fill('Quota review worker');
  await expect(shelf.getByRole('button', { name: /^Quota review worker/ })).toHaveCount(0);
});
