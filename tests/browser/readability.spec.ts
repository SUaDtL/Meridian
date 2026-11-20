import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import type { StudioDocument } from '../../src/types';

async function openProject(page: Page, project: StudioDocument) {
  await page.addInitScript(({ key, project }) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] })),
    { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: `Open v3 project ${project.title}` }).click();
  return page.getByRole('dialog', { name: project.title });
}

async function downloadProject(page: Page, live: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing readability project download.');
  return JSON.parse(await readFile(path, 'utf8'));
}

test('checks the accepted drawing in a fixed viewing area without changing its source or revision', async ({ page }) => {
  const source = 'flowchart LR\n  A["Service"]\n  B["Service"]\n  C["Warehouse"]\n  A e1@--> B\n';
  const live = await openProject(page, { ...createDocument(), title: 'Readability example', source });
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

test('cancels checking, terminates its worker, and lets the same diagram be checked again', async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    const terminate = Worker.prototype.terminate;
    let delayed: Worker | undefined;
    Worker.prototype.postMessage = function (value, transfer) {
      if (!delayed && Array.isArray(value?.targets) && value.frame && value.profile) {
        delayed = this;
        return;
      }
      Reflect.apply(post, this, transfer === undefined ? [value] : [value, transfer]);
    };
    Worker.prototype.terminate = function () {
      if (this === delayed) document.documentElement.dataset.cancelledReadability = 'yes';
      return terminate.call(this);
    };
  });
  const source = 'flowchart LR\n A[First]\n B[Second]\n A --> B\n';
  const live = await openProject(page, { ...createDocument(), title: 'Cancellable check', source });
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  const run = check.getByRole('button', { name: 'Check diagram' });
  await run.click();
  await expect(check.getByRole('status')).toHaveText('Checking the current diagram…');
  await check.getByRole('button', { name: 'Cancel check' }).click();
  await expect(check.getByRole('status')).toHaveText('Readability work cancelled.');
  await expect(page.locator('html')).toHaveAttribute('data-cancelled-readability', 'yes');
  await expect(run).toBeFocused();
  await expect(check.getByRole('region', { name: 'Readability results' })).toHaveCount(0);
  await run.click();
  await expect(check.getByRole('region', { name: 'Readability results' })).toBeVisible();
  await expect(check.getByText('Readability work cancelled.')).toHaveCount(0);
});

test('compares verified solid text and leaves the gradient node unmeasured', async ({ page }) => {
  const source = 'flowchart LR\n  A["Low contrast"]\n  B["Gradient surface"]\n';
  const project = { ...createDocument(), title: 'Contrast example', source };
  project.design.elements['node:A'] = { fill: '#ffffff', color: '#eeeeee' };
  const live = await openProject(page, project);
  const before = await downloadProject(page, live);
  const a = before.identity.elements.find((element: { binding: { sourceId: string } }) => element.binding.sourceId === 'A').id;
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  await check.getByRole('combobox', { name: 'Viewing profile' }).selectOption('presentation');
  await check.getByRole('button', { name: 'Check diagram' }).click();
  const report = check.getByRole('region', { name: 'Readability results' });
  await expect(report.getByText('Solid text contrast · 1 measured · 1 unknown · 0 not applicable')).toBeVisible();
  await expect(report.getByText(/Low contrast has a contrast ratio of 1\.16\d+ to 1/)).toBeVisible();
  await expect(report.getByText(/Gradient surface has a contrast ratio/)).toHaveCount(0);
  await report.getByRole('button', { name: 'Preview text contrast fix for Low contrast' }).click();
  const fix = check.getByRole('region', { name: 'Proposed contrast fix' });
  await expect(fix.getByText(/Contrast changes from 1\.16:1 to 21\.00:1/)).toBeVisible();
  await fix.getByRole('button', { name: 'Apply text color' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = await downloadProject(page, live);
  expect(after.source).toBe(source);
  expect(after.identity).toEqual(before.identity);
  expect(after.design.elements[a]).toEqual({ ...before.design.elements[a], color: '#000000' });
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  await check.getByRole('combobox', { name: 'Viewing profile' }).selectOption('presentation');
  await check.getByRole('button', { name: 'Check diagram' }).click();
  await expect(report.getByText('Solid text contrast · 1 measured · 1 unknown · 0 not applicable')).toBeVisible();
  await expect(report.getByRole('button', { name: /Preview text contrast fix/ })).toHaveCount(0);
  await check.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect((await downloadProject(page, live)).design).toEqual(before.design);
});

test('measures rectangular label spill in a fixed viewing area at either pixel density', async ({ page, browser }, info) => {
  const source = 'flowchart LR\n  A["This label exceeds its backing"]\n  B["Square"]\n  C(("Circle"))\n  A --> B\n  style A width:36px\n';
  const project = { ...createDocument(), title: 'Label containment example', source };
  project.design.elements['node:A'] = { shape: 'rect' };
  project.design.elements['node:B'] = { shape: 'rect' };
  async function measure(at: Page) {
    const live = await openProject(at, project);
    await live.getByRole('button', { name: 'Check readability', exact: true }).click();
    const check = at.getByRole('dialog', { name: 'Check readability' });
    await check.getByRole('combobox', { name: 'Viewing profile' }).selectOption('presentation');
    await check.getByRole('button', { name: 'Check diagram' }).click();
    const report = check.getByRole('region', { name: 'Readability results' });
    await expect(report.getByText('Label containment · 2 measured · 1 unknown · 1 not applicable')).toBeVisible();
    const finding = report.getByText(/This label exceeds its backing \(A\) extends [\d.]+ CSS pixels beyond its rectangular shape/);
    await expect(finding).toBeVisible();
    return finding.textContent();
  }
  const expected = await measure(page);
  const dense = await browser.newPage({ baseURL: info.project.use.baseURL, deviceScaleFactor: 2 });
  try {
    expect(await measure(dense)).toBe(expected);
  } finally {
    await dense.close();
  }
});

test('reviews separate regions and keeps an ignored name finding across unrelated revision changes', async ({ page }, info) => {
  const source = 'flowchart LR\n A[Service]\n B[Service]\n C[Warehouse]\n A route@--> B\n';
  let live = await openProject(page, { ...createDocument(), title: 'Name review', source });
  const check = page.getByRole('dialog', { name: 'Check readability' });
  const report = check.getByRole('region', { name: 'Readability results' });
  const duplicate = report.locator('li').filter({ has: page.getByText(/2 distinct elements share the name Service/) });
  async function reviewNames() {
    await live.getByRole('button', { name: 'Check readability', exact: true }).click();
    await check.getByRole('button', { name: 'Check diagram' }).click();
    await expect(report).toBeVisible();
  }
  await reviewNames();
  await expect(duplicate).toBeVisible();
  await report.getByText('Review regions', { exact: true }).click();
  await expect(report.getByText('Service, Service', { exact: true })).toBeVisible();
  await expect(report.getByText('Warehouse', { exact: true })).toBeVisible();
  await duplicate.getByRole('button', { name: 'Ignore for this session' }).click();
  await expect(duplicate).toHaveCount(0);
  await expect(report.getByRole('status')).toContainText('1 ignored this session');
  await check.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Edit heading', exact: true }).click();
  const heading = page.getByRole('dialog', { name: 'Edit heading' });
  await heading.getByRole('textbox', { name: 'Title', exact: true }).fill('Updated name review');
  await heading.getByRole('button', { name: 'Apply heading' }).click();
  live = page.getByRole('dialog', { name: 'Updated name review' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Updated name review' })).toBeVisible();
  await reviewNames();
  await expect(duplicate).toHaveCount(0);
  await check.getByRole('checkbox', { name: 'Show ignored findings' }).check();
  await duplicate.getByRole('button', { name: 'Restore finding' }).click();
  await duplicate.getByText('Review elements with this name', { exact: true }).click();
  await expect(duplicate.getByText('Service · node B')).toBeVisible();
  await page.screenshot({ path: info.outputPath('coach-names-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('coach-names-mobile.png') });
  await duplicate.getByRole('button', { name: 'Edit label 2' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(edit.getByRole('combobox', { name: 'Node to rename' }).locator('option:checked')).toHaveText('Service (B)');
  await edit.getByRole('textbox', { name: 'Node label' }).fill('Payments');
  await edit.getByRole('button', { name: 'Preview change' }).click();
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const result = await downloadProject(page, live);
  expect(result.source).toBe(source.replace('B[Service]', 'B["Payments"]'));
  expect(JSON.stringify(result)).not.toContain('ignored');
  await expect(live.getByRole('img', { name: 'Diagram preview for Updated name review' })).toBeVisible();
  await reviewNames();
  await expect(duplicate).toHaveCount(0);
});
