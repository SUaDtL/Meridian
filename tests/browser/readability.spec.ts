import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { solidContrast } from '../../src/lib/authoring/solid-text-color';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import type { StudioDocument } from '../../src/types';

async function showCoverage(check: import('@playwright/test').Locator) {
  const summary = check.getByText('Measurement coverage', { exact: true });
  await expect(summary).toBeVisible();
  if (!(await summary.evaluate(el => el.closest('details')!.open))) await summary.click();
}

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

test('checks the accepted drawing and shows the exact finding targets without editing', async ({ page }, info) => {
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
  await showCoverage(check);
  await expect(report.getByText('Viewed label size · 3 measured · 0 unknown · 1 not applicable')).toBeVisible();
  await expect(report.getByText(/Service measures .* CSS pixels/).first()).toBeVisible();
  await expect(report.getByText(/2 distinct elements share the name Service/)).toBeVisible();
  await expect(report.getByText('The diagram contains 2 regions with no connection between them.')).toBeVisible();
  const show = report.getByRole('listitem').filter({ hasText: '2 distinct elements share the name Service' }).getByRole('button', { name: 'Show in diagram' });
  await show.click();
  const highlighted = page.getByRole('dialog', { name: 'Finding on the diagram' });
  await expect(highlighted.getByRole('heading', { name: 'Duplicate names' })).toBeFocused();
  const image = highlighted.getByRole('img', { name: 'Diagram with highlighted elements' });
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
  await expect(highlighted.getByRole('listitem')).toHaveText(['Service (A)', 'Service (B)']);
  await page.screenshot({ path: info.outputPath('readability-targets-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('readability-targets-mobile.png') });
  await highlighted.getByRole('button', { name: 'Return to checks' }).click();
  await expect(show).toBeFocused();
  await expect(report.getByText(/2 distinct elements share the name Service/)).toBeVisible();
  await check.getByRole('combobox', { name: 'Viewing profile' }).selectOption('document');
  await check.getByRole('spinbutton', { name: 'Allocated width in CSS pixels' }).fill('125');
  await expect(check.getByText('125 CSS pixels allocated · Fits width · Project revision 0')).toBeVisible();
  await expect(report).toHaveCount(0);
  await check.getByRole('button', { name: 'Check diagram' }).click();
  await expect(report.getByText(/Service measures .* CSS pixels/).first()).toBeVisible();
  await check.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Design', exact: true }).click();
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  await expect(check.getByRole('combobox', { name: 'Viewing profile' })).toHaveValue('document');
  await expect(check.getByRole('spinbutton', { name: 'Allocated width in CSS pixels' })).toHaveValue('125');
  await expect(report).toHaveCount(0);
  await check.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Build', exact: true }).click();
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

const crossingSource = 'flowchart LR\n A[First]\n B[Second]\n C[Third]\n D[Fourth]\n A a@--> C\n A b@--> D\n B c@--> C\n B d@--> D\n';

test('reports measured route candidates and opens the normal layout review', async ({ page }) => {
  const project = { ...createDocument(), title: 'Crossing review', source: crossingSource };
  project.settings.layout = 'dagre';
  const live = await openProject(page, project);
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  await check.getByRole('button', { name: 'Check diagram' }).click();
  const report = check.getByRole('region', { name: 'Readability results' });
  await showCoverage(check);
  await expect(report.getByText('Crossing candidates · 4 measured · 0 unknown · 4 not applicable')).toBeVisible();
  await expect(report.getByText(/cross approximately once within the measured routes/).first()).toBeVisible();
  await report.getByRole('button', { name: 'Compare layouts' }).first().click();
  const layouts = page.getByRole('dialog', { name: 'Compare layouts' });
  await layouts.getByRole('button', { name: 'Preview Balanced' }).click();
  const comparison = layouts.getByRole('region', { name: 'Connection crossings' });
  await expect(comparison.getByText(/Current · 1 crossing candidate in checked routes · 4 measured · 0 unknown/)).toBeVisible();
  await expect(comparison.getByText(/Proposed · 0 crossing candidates in checked routes · 3 measured · 1 unknown/)).toBeVisible();
  await expect(comparison).toContainText('Crossing coverage is incomplete for this comparison.');
});

test('reports an ELK bridge arc as unknown route geometry', async ({ page }) => {
  const project = { ...createDocument(), title: 'Bridge review', source: crossingSource };
  project.settings.layout = 'elk';
  project.settings.curve = 'linear';
  const live = await openProject(page, project);
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  await check.getByRole('button', { name: 'Check diagram' }).click();
  await showCoverage(check);
  await expect(check.getByRole('region', { name: 'Readability results' })
    .getByText('Crossing candidates · 3 measured · 1 unknown · 4 not applicable')).toBeVisible();
});

test('reconsiders dismissed contrast when the resolved colors change at the same ratio', async ({ page }) => {
  const original = 'flowchart LR\n A[Status]\n style A fill:#ffffff,color:#eeeeee\n';
  let live = await openProject(page, { ...createDocument(), title: 'Contrast dismissal', source: original });
  const check = page.getByRole('dialog', { name: 'Check readability' });
  const report = check.getByRole('region', { name: 'Readability results' });
  const ratio = solidContrast({ channels: [238, 238, 238], opacity: 1 }, [255, 255, 255]);
  const ratioText = `Status has a contrast ratio of ${ratio} to 1.`;
  const exact = report.getByText(ratioText);
  const finding = report.getByRole('listitem').filter({ hasText: ratioText });

  async function checkSolidText() {
    await live.getByRole('button', { name: 'Check readability', exact: true }).click();
    await check.getByRole('combobox', { name: 'Viewing profile' }).selectOption('presentation');
    await check.getByRole('button', { name: 'Check diagram' }).click();
    await expect(report).toBeVisible();
  }

  await checkSolidText();
  await expect(exact).toBeVisible();
  await finding.getByRole('button', { name: 'Ignore for this session' }).click();
  await expect(exact).toHaveCount(0);
  await check.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Edit heading', exact: true }).click();
  const heading = page.getByRole('dialog', { name: 'Edit heading' });
  await heading.getByRole('textbox', { name: 'Title', exact: true }).fill('Updated contrast dismissal');
  await heading.getByRole('button', { name: 'Apply heading' }).click();
  live = page.getByRole('dialog', { name: 'Updated contrast dismissal' });
  await expect(live.getByRole('img', { name: 'Diagram preview for Updated contrast dismissal' })).toBeVisible();
  await checkSolidText();
  await expect(exact).toHaveCount(0);
  await expect(report.getByRole('status')).toContainText('1 ignored this session');
  await check.getByRole('button', { name: 'Close dialog' }).click();

  await live.getByRole('button', { name: 'Edit Mermaid source', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Mermaid source' });
  await editor.getByRole('textbox', { name: 'Mermaid source' }).fill(original.replace('fill:#ffffff,color:#eeeeee', 'fill:#eeeeee,color:#ffffff'));
  await editor.getByRole('button', { name: 'Preview source' }).click();
  await editor.getByRole('button', { name: 'Apply source' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  await checkSolidText();
  await expect(exact).toBeVisible();
  await expect(report.getByRole('status')).not.toContainText('ignored');
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
  await showCoverage(check);
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
  await showCoverage(check);
  await expect(report.getByText('Solid text contrast · 1 measured · 1 unknown · 0 not applicable')).toBeVisible();
  await expect(report.getByRole('button', { name: /Preview text contrast fix/ })).toHaveCount(0);
  await check.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect((await downloadProject(page, live)).design).toEqual(before.design);
});

test('reviews and undoes a measured stroke color on an exposed solid canvas', async ({ page }) => {
  const source = 'flowchart LR\n  A["Input"]\n  B["Output"]\n  A connection@--- B\n';
  const project = { ...createDocument(), title: 'Connector contrast example', source };
  project.settings = { ...project.settings, theme: 'porcelain', layout: 'dagre', curve: 'linear', motion: 'none',
    background: 'none', ambient: false, shadow: false, glow: false };
  project.design.elements['edge:id:connection'] = { stroke: '#f3f3ef', strokeWidth: 2 };
  const live = await openProject(page, project);
  await expect(live.getByRole('img', { name: 'Diagram preview for Connector contrast example' })).toBeVisible();
  const before = await downloadProject(page, live);
  const edge = before.identity.elements.find((item: { binding: { sourceId: string } }) => item.binding.sourceId === 'connection').id;
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  await check.getByRole('button', { name: 'Check diagram' }).click();
  const report = check.getByRole('region', { name: 'Readability results' });
  await showCoverage(check);
  await expect(report.getByText('Connector contrast · 1 measured · 0 unknown · 2 not applicable')).toBeVisible();
  await expect(report.getByText(/Input – Output measures 1 to 1 at the center/)).toBeVisible();
  await report.getByRole('button', { name: 'Preview stroke contrast fix for Input – Output' }).click();
  const proposal = check.getByRole('region', { name: 'Proposed contrast fix' });
  await expect(proposal.getByText(/Contrast changes from 1\.00:1 to 18\.8/)).toBeVisible();
  await proposal.getByRole('button', { name: 'Apply stroke color' }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  const after = await downloadProject(page, live);
  expect(after).toEqual({ ...before, revision: before.revision + 1, updatedAt: after.updatedAt,
    design: { ...before.design, elements: { ...before.design.elements, [edge]: { stroke: '#000000', strokeWidth: 2 } } },
  });
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(live.getByText('Saved in this browser.')).toBeVisible();
  expect((await downloadProject(page, live)).design).toEqual(before.design);
});

test('keeps the connector contrast unknown when there is an arrowhead', async ({ page }) => {
  const source = 'flowchart LR\n  A[Input]\n  B[Output]\n  A direction@--> B\n';
  const project = { ...createDocument(), title: 'Unverified arrowhead contrast', source };
  project.settings = { ...project.settings, theme: 'porcelain', layout: 'dagre', curve: 'linear', motion: 'none',
    background: 'none', ambient: false, shadow: false, glow: false };
  const live = await openProject(page, project);
  await live.getByRole('button', { name: 'Check readability', exact: true }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  await check.getByRole('button', { name: 'Check diagram' }).click();
  const report = check.getByRole('region', { name: 'Readability results' });
  await showCoverage(check);
  await expect(report.getByText('Connector contrast · 0 measured · 1 unknown · 2 not applicable')).toBeVisible();
  await expect(report.getByRole('button', { name: /Preview stroke contrast fix/ })).toHaveCount(0);
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
    await showCoverage(check);
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
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(live.getByRole('img', { name: 'Diagram preview for Updated name review' })).toBeVisible();
  await live.getByRole('navigation', { name: 'Workspace panels' }).getByRole('button', { name: 'Design', exact: true }).click();
  await reviewNames();
  await expect(duplicate).toHaveCount(0);
});

test('keeps a dismissed role paint finding across a heading edit and rechecks newly measured paint', async ({ page }) => {
  const base = JSON.parse(await readFile(new URL('../../src/lib/authoring/fixtures/example-project.json', import.meta.url), 'utf8'));
  const target = base.roles[0].elementId;
  const originalColor = '#62355c';
  const changedColor = '#a13c65';
  const expectedColor = '#0f172a';
  const project = {
    ...base, title: 'Role paint review',
    design: { ...base.design, elements: { [target]: { color: originalColor } },
      recipeElements: { [target]: { recipe: { id: 'clear', version: '1.0.0' }, style: { color: expectedColor } } } },
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  const library = page.getByRole('dialog', { name: 'Project migration and recovery' });
  await library.getByLabel('Import v3 project file').setInputFiles({
    name: 'role-paint.meridian.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)),
  });
  await library.getByRole('button', { name: 'Open v3 project Role paint review' }).click();
  let live = page.getByRole('dialog', { name: 'Role paint review' });
  const check = page.getByRole('dialog', { name: 'Check readability' });
  const results = check.getByRole('region', { name: 'Readability results' });
  const finding = results.getByRole('listitem').filter({ hasText: /API has the service role/ });
  async function measure() {
    await live.getByRole('button', { name: 'Check readability' }).click();
    await check.getByRole('button', { name: 'Check diagram' }).click();
    await expect(results).toBeVisible();
  }
  await measure();
  await expect(finding).toContainText('renders as ' + originalColor);
  await expect(finding).toContainText('saved recipe specifies ' + expectedColor);
  await finding.getByRole('button', { name: 'Ignore for this session' }).click();
  await expect(finding).toHaveCount(0);
  await check.getByRole('button', { name: 'Close dialog' }).click();

  await live.getByRole('button', { name: 'Edit heading' }).click();
  const heading = page.getByRole('dialog', { name: 'Edit heading' });
  await heading.getByRole('textbox', { name: 'Title', exact: true }).fill('Updated role paint review');
  await heading.getByRole('button', { name: 'Apply heading' }).click();
  live = page.getByRole('dialog', { name: 'Updated role paint review' });
  await measure();
  await expect(finding).toHaveCount(0);
  await expect(results.getByRole('status')).toContainText('1 ignored this session');
  await check.getByRole('button', { name: 'Close dialog' }).click();

  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^API/ }).click();
  await outline.getByRole('button', { name: 'Change selected text color' }).click();
  const change = page.getByRole('dialog', { name: 'Change selected text color' });
  await change.getByLabel('New text color').fill(changedColor);
  await change.getByRole('button', { name: 'Preview text color' }).click();
  await change.getByRole('button', { name: 'Apply to 1 eligible label' }).click();
  await measure();
  await expect(finding).toContainText('renders as ' + changedColor);
  await expect(finding).toContainText('saved recipe specifies ' + expectedColor);
  await expect(finding.getByRole('button', { name: 'Ignore for this session' })).toBeVisible();
  await check.getByRole('button', { name: 'Close dialog' }).click();
  const accepted = await downloadProject(page, live);
  expect(accepted.source).toBe(project.source);
  expect(accepted.design).toEqual({ ...project.design, elements: { [target]: { color: changedColor } } });
});

test('keeps fixed-profile findings identical across canvas zoom and PNG density', async ({ page }) => {
  await page.addInitScript(() => {
    const frames = new Map<string, Blob>();
    Object.defineProperty(window, 'readabilityFixtureFrames', { value: frames });
    const create = URL.createObjectURL;
    URL.createObjectURL = value => {
      const url = create(value);
      if (value instanceof Blob && value.type === 'image/svg+xml') frames.set(url, value);
      return url;
    };
  });
  const source = 'flowchart LR\r\n  A[Service] --> B[Warehouse]\r\n';
  const live = await openProject(page, { ...createDocument(), title: 'Readability export density', source });
  const check = page.getByRole('dialog', { name: 'Check readability' });
  const report = check.getByRole('region', { name: 'Readability results' });
  const width = check.getByRole('spinbutton', { name: 'Allocated width in CSS pixels' });
  const presentation = page.getByRole('dialog', { name: 'Take your diagram with you.' });
  const approved = await downloadProject(page, live);
  async function measureLabel() {
    await live.getByRole('button', { name: 'Check readability', exact: true }).click();
    await check.getByRole('combobox', { name: 'Viewing profile' }).selectOption('document');
    await width.fill('125');
    await expect(check.getByText('125 CSS pixels allocated · Fits width · Project revision 0')).toBeVisible();
    await check.getByRole('button', { name: 'Check diagram' }).click();
    await showCoverage(check);
    await expect(report.getByText('Viewed label size · 2 measured · 0 unknown · 1 not applicable')).toBeVisible();
    const finding = report.getByText(/Service measures [\d.]+ CSS pixels in this viewing area/);
    await expect(finding).toBeVisible();
    const result = await report.innerText();
    await check.getByRole('button', { name: 'Close dialog' }).click();
    return result;
  }
  async function downloadPngAt(scale: '1' | '2') {
    await live.getByRole('button', { name: 'Export diagram', exact: true }).click();
    await presentation.getByRole('combobox', { name: 'Resolution' }).selectOption(scale);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      presentation.getByRole('button', { name: 'Download PNG', exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe('readability-export-density.png');
    const path = await download.path();
    if (!path) throw new Error('Missing exported PNG.');
    const bytes = await readFile(path);
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
    await expect(presentation.getByRole('status')).toContainText('PNG downloaded');
    await presentation.getByRole('button', { name: 'Close dialog' }).click();
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const image = live.getByRole('img', { name: 'Diagram preview for Readability export density' });
  const canvasWidth = () => image.evaluate(async (element: HTMLImageElement) => {
    const frames = (window as Window & { readabilityFixtureFrames: ReadonlyMap<string, Blob> }).readabilityFixtureFrames;
    const source = await frames.get(element.src)?.text();
    if (!source) throw new Error('Missing canvas preview.');
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
    const box = svg.querySelector('svg[data-meridian-export] > svg')?.getAttribute('viewBox');
    return Number(box?.trim().split(/[ ,]+/)[2]);
  });
  const fullWidth = await canvasWidth();
  expect(fullWidth).toBeGreaterThan(0);
  const standard = await downloadPngAt('1');
  const firstFinding = await measureLabel();
  await live.getByRole('button', { name: 'Outline', exact: true }).click();
  const outline = page.getByRole('dialog', { name: 'Diagram outline' });
  await outline.getByRole('treeitem', { name: /^Service/ }).click();
  await outline.getByRole('button', { name: 'Frame selected elements' }).click();
  await expect(live.getByText('Framed around 1 element.')).toBeVisible();
  await expect.poll(canvasWidth).toBeLessThan(fullWidth);
  const dense = await downloadPngAt('2');
  expect(dense.width).toBeGreaterThanOrEqual(standard.width * 2);
  expect(dense.width).toBeLessThanOrEqual(standard.width * 2 + 1);
  expect(dense.height).toBeGreaterThanOrEqual(standard.height * 2);
  expect(dense.height).toBeLessThanOrEqual(standard.height * 2 + 1);
  expect(await measureLabel()).toBe(firstFinding);
  await expect.poll(canvasWidth).toBeLessThan(fullWidth);
  expect(await downloadProject(page, live)).toEqual(approved);
});

test('reports both crossing limits from the worker without ranking an incomplete result', async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (value, transfer) {
      if (Array.isArray(value?.targets) && value.frame && value.profile) {
        let route = 0;
        value = { ...value, targets: value.targets.map((target: { kind: string }) => {
          if (target.kind !== 'edge') return target;
          const index = route++;
          if (index === 3) return { ...target, measuredRoute: undefined, routeOverSegmentLimit: true };
          const segments = index === 0 ? 166 : 167;
          return { ...target, measuredRoute: Array.from({ length: segments + 1 }, (_, point) => [(point % 2) * 100, index]) };
        }) };
      }
      Reflect.apply(post, this, transfer === undefined ? [value] : [value, transfer]);
    };
  });
  const live = await openProject(page, { ...createDocument(), title: 'Bounded crossing evidence', source: crossingSource });
  const before = await downloadProject(page, live);
  await live.getByRole('button', { name: 'Check readability' }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  await check.getByRole('button', { name: 'Check diagram' }).click();
  const result = check.getByRole('region', { name: 'Readability results' });
  await expect(result).toContainText('Crossing candidates · 3 measured · 1 unknown · 4 not applicable');
  await expect(result).toContainText('100,000 segment pairs checked. Not fully measured. 1 route skipped at the segment limit. 24,750 segment pairs skipped.');
  await expect(result.getByText(/no issues|best layout/i)).toHaveCount(0);
  await check.getByRole('button', { name: 'Close dialog' }).click();
  expect(await downloadProject(page, live)).toEqual(before);
});

test('terminates both timed-out readability workers and requires narrower input after the retry', async ({ page }) => {
  await page.addInitScript(() => {
    const post = Worker.prototype.postMessage;
    const terminate = Worker.prototype.terminate;
    const blocked = new WeakSet<Worker>();
    let started = 0;
    let stopped = 0;
    Worker.prototype.postMessage = function (value, transfer) {
      if (Array.isArray(value?.targets) && value.frame && value.profile && started < 2) {
        blocked.add(this);
        document.documentElement.dataset.readabilityWorkersStarted = String(++started);
        return;
      }
      Reflect.apply(post, this, transfer === undefined ? [value] : [value, transfer]);
    };
    Worker.prototype.terminate = function () {
      if (blocked.delete(this)) document.documentElement.dataset.readabilityWorkersStopped = String(++stopped);
      return terminate.call(this);
    };
  });
  const live = await openProject(page, { ...createDocument(), title: 'Readability deadline', source: crossingSource });
  await live.getByRole('button', { name: 'Check readability' }).click();
  const check = page.getByRole('dialog', { name: 'Check readability' });
  const results = check.getByRole('region', { name: 'Readability results' });
  const html = page.locator('html');
  await check.getByRole('button', { name: 'Check diagram' }).click();
  await expect(check.getByRole('alert')).toHaveText('Not fully measured. Checking the diagram timed out.');
  await expect(html).toHaveAttribute('data-readability-workers-stopped', '1');
  await expect(results).toHaveCount(0);
  await check.getByRole('button', { name: 'Retry for five seconds' }).click();
  await expect(check.getByRole('alert')).toHaveText('Not fully measured. The retry timed out. Try a smaller diagram before rechecking.', { timeout: 8000 });
  await expect(html).toHaveAttribute('data-readability-workers-started', '2');
  await expect(html).toHaveAttribute('data-readability-workers-stopped', '2');
  await expect(check.getByRole('button', { name: 'Check diagram' })).toBeDisabled();
  await expect(results).toHaveCount(0);
  await check.getByRole('button', { name: 'Close dialog' }).click();
  await live.getByRole('button', { name: 'Check readability' }).click();
  await check.getByRole('button', { name: 'Check diagram' }).click();
  await expect(results).toBeVisible();
  await expect(check.getByRole('alert')).toHaveCount(0);
});
