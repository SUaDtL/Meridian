import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectWorkspaceOmits } from './helpers';

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing chart download.');
  return readFile(path, 'utf8');
}

test('discloses coincident scatter points across series and excludes clipped positions from the plot count', async ({ page, browser }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Chart data file').setInputFiles({
    name: 'scattered.csv', mimeType: 'text/csv', buffer: Buffer.from('X,Y,Series\n1,2,Red\n1,2,Blue\n1,2,Blue\n2,3,Red\n9,9,Red\n9,9,Blue\n'),
  });
  await chart.getByRole('button', { name: 'Read data' }).click();
  for (const field of ['X', 'Y']) await chart.getByRole('group', { name: field, exact: true }).getByLabel('Type').selectOption('number');
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  await chart.getByLabel('Title', { exact: true }).fill('Shared positions');
  await chart.getByLabel('Chart type').selectOption('scatter');
  await chart.getByLabel('Y field').selectOption({ label: 'Y' });
  await chart.getByLabel('Series field').selectOption({ label: 'Series' });
  await chart.getByLabel('Set a custom X range').check();
  await chart.getByLabel('X minimum').fill('0');
  await chart.getByLabel('X maximum').fill('3');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  const summary = '3 points share 1 position in the plot.';
  const preview = chart.getByRole('img', { name: 'Shared positions' });
  await expect(preview).toHaveAccessibleDescription(/3 points share 1 position in the plot\./);
  await expect(preview.locator('circle')).toHaveCount(6);
  await expect(preview.getByText('2 outside range · 3 overlapping points')).toBeVisible();
  const displayed = chart.getByRole('table', { name: 'Displayed values' });
  await expect(displayed.getByRole('cell', { name: '3 overlapping points', exact: true })).toHaveCount(3);
  await expect(displayed.getByRole('cell', { name: 'Outside range · 2 overlapping points', exact: true })).toHaveCount(2);
  await page.screenshot({ path: info.outputPath('scatter-overlap-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('scatter-overlap-mobile.png') });
  await chart.getByRole('button', { name: 'Create chart project' }).click();
  const html = await download(page, chart.getByRole('button', { name: 'Download accessible HTML' }));
  const offline = await browser.newContext({ offline: true });
  try {
    const exportPage = await offline.newPage();
    await exportPage.setContent(html);
    await expect(exportPage.getByRole('paragraph').filter({ hasText: summary })).toBeVisible();
    const table = exportPage.getByRole('table', { name: 'Displayed values' });
    await expect(table.getByRole('cell', { name: '3 overlapping points', exact: true })).toHaveCount(3);
    await expect(table.getByRole('cell', { name: 'Outside range · 2 overlapping points', exact: true })).toHaveCount(2);
  } finally { await offline.close(); }
});

test('confirms typed file data, reviews an exact aggregate, saves, reopens, and exports accessible HTML', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Chart data file').setInputFiles({
    name: 'team.json', mimeType: 'application/json',
    buffer: Buffer.from('[{"Team":"North","Requests":0.1},{"Team":"North","Requests":0.2},{"Team":"South","Requests":"unparsed-chart-cell"}]'),
  });
  await chart.getByRole('button', { name: 'Read data' }).click();
  const requests = chart.getByRole('group', { name: 'Requests' });
  await requests.getByLabel('Type').selectOption('number');
  await requests.getByLabel('Unit').fill('requests');
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  await expect(chart.getByRole('alert')).toContainText('Input row 3, column “Requests”');
  await requests.getByRole('combobox', { name: 'Invalid values' }).selectOption('null');
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  const conversion = chart.getByRole('region', { name: 'Data conversion' });
  await expect(conversion).toContainText('Requests · 1 invalid · 0 empty');
  await chart.getByLabel('Title', { exact: true }).fill('Requests by team');
  await chart.getByLabel('Subtitle', { exact: true }).fill('Résumé 📊');
  await chart.getByLabel('Aggregation').selectOption('sum');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(conversion).toContainText('Requests · 1 invalid · 0 empty');
  await chart.getByRole('button', { name: 'Back to mapping' }).click();
  await chart.getByRole('button', { name: 'Save data draft' }).click();
  await expect(chart.getByText('Typed data and mapping draft saved in this browser.')).toBeVisible();
  await expectWorkspaceOmits(page, ['unparsed-chart-cell']);
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  await chart.getByRole('button', { name: 'Resume Requests by team' }).click();
  await expect(chart.getByText(/The restored draft uses the reviewed missing-value rules/)).toBeVisible();
  await expect(chart.getByLabel('Aggregation')).toHaveValue('sum');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(chart.getByRole('img', { name: 'Requests by team' })).toBeVisible();
  const table = chart.getByRole('table', { name: 'Displayed values' });
  await expect(chart.getByRole('img', { name: 'Requests by team' })).toHaveAccessibleDescription(
    /Bar chart of Requests \(requests\) by Team.*Aggregation is sum/);
  await expect(table.getByRole('columnheader', { name: 'Requests (requests)' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'North' })).toBeVisible();
  const storage = chart.getByRole('region', { name: 'Chart storage' });
  const datasetSize = await storage.getByText(/^Typed dataset /).textContent();
  const projectSize = await storage.getByText(/^Complete project /).textContent();
  await expect(table.getByRole('row', { name: 'North 0.3 2 2 Included' })).toBeVisible();
  await expect(table.getByRole('row', { name: 'South Missing 1 0 Missing Y' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chart-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chart.getByRole('img', { name: 'Requests by team' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chart-review-mobile.png') });
  await chart.getByRole('button', { name: 'Create chart project' }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const initialText = await download(page, chart.getByRole('button', { name: 'Download chart project' }));
  const initial = JSON.parse(initialText);
  expect(datasetSize).toMatch(`Typed dataset ${Buffer.byteLength(JSON.stringify(initial.dataset))} of`);
  expect(projectSize).toMatch(`Complete project ${Buffer.byteLength(initialText).toLocaleString('en-US')} of`);
  expect(Buffer.byteLength(initialText)).toBeGreaterThan(initialText.length);
  expect(initial).toMatchObject({
    schema: 'meridian-chart/v1', documentKind: 'chart',
    dataset: { rows: [{ cells: ['North', '0.1'] }, { cells: ['North', '0.2'] }, { cells: ['South', null] }] },
    chartSpec: { mark: 'bar', aggregation: 'sum' },
  });
  expect(initial).not.toHaveProperty('source');
  await expectWorkspaceOmits(page, ['unparsed-chart-cell']);

  await page.reload();
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Chart projects' }).click();
  const saved = page.getByRole('dialog', { name: 'Chart projects' });
  await saved.getByRole('button', { name: 'Requests by team' }).click();
  await expect(saved.getByRole('img', { name: 'Requests by team' })).toBeVisible();
  const restored = JSON.parse(await download(page, saved.getByRole('button', { name: 'Download chart project' })));
  expect(restored).toEqual(initial);
  await saved.getByRole('button', { name: 'Source data', exact: true }).click();
  await expect(saved.getByRole('table', { name: 'Source data' }).getByRole('cell', { name: '0.1' })).toBeVisible();
  const html = await download(page, saved.getByRole('button', { name: 'Download accessible HTML' }));
  await page.context().setOffline(true);
  await page.setContent(html);
  await expect(page.getByRole('img', { name: 'Requests by team' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Requests by team' })).toHaveAccessibleDescription(
    /Bar chart of Requests \(requests\) by Team.*Aggregation is sum/);
  const offline = page.getByRole('table', { name: /Displayed values/ });
  await expect(offline.getByRole('columnheader', { name: 'Requests (requests)' })).toBeVisible();
  const north = offline.getByRole('row', { name: 'North 0.3 2 2 Included' });
  await expect(north.getByRole('rowheader', { name: 'North' })).toBeVisible();
  await expect(north.getByRole('cell', { name: '0.3', exact: true })).toBeVisible();
  await expect(page.getByRole('paragraph').filter({ hasText: /Bar chart of Requests/ })).toBeVisible();
});

test('reviews a clipped chart range, applies a frame change, and restores exact mapping with Undo', async ({ page }) => {
  const fixture = await readFile(new URL('../../src/lib/authoring/fixtures/example-chart.json', import.meta.url));
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Import a Meridian chart project').setInputFiles({ name: 'example.meridian.json', mimeType: 'application/json', buffer: fixture });
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const getProject = async () => JSON.parse(await download(page, chart.getByRole('button', { name: 'Download chart project' })));
  const initial = await getProject();
  const otherPage = await page.context().newPage();
  await otherPage.goto('/');
  await otherPage.getByRole('button', { name: 'Manage projects' }).click();
  await otherPage.getByRole('button', { name: 'Chart projects' }).click();
  const otherChart = otherPage.getByRole('dialog', { name: 'Chart projects' });
  await otherChart.getByRole('button', { name: initial.title, exact: true }).click();
  await expect(otherChart.getByText('Chart saved in this browser.')).toBeVisible();
  await chart.getByRole('button', { name: 'Edit chart mapping and frame' }).click();
  await chart.getByLabel('Title', { exact: true }).fill('Requests in a reviewed range');
  await chart.getByLabel('Frame ratio').selectOption('4:3');
  await chart.getByLabel('Show the Meridian signature').uncheck();
  await chart.getByLabel('Set a custom Y range').check();
  await chart.getByLabel('Y minimum').fill('5.0');
  await chart.getByLabel('Y maximum').fill('10');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(chart.getByRole('alert')).toContainText('Accept the truncated bar axis');
  await chart.getByLabel(/Accept a truncated axis/).check();
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(chart.getByRole('img', { name: 'Requests in a reviewed range' })).toBeVisible();
  await expect(chart.getByText('Truncated Y axis · 1 outside range', { exact: true })).toBeVisible();
  await expect(chart.getByRole('table', { name: 'Displayed values' }).getByRole('row', { name: /North 12.*Outside range/ })).toBeVisible();
  await chart.getByRole('button', { name: 'Apply chart changes' }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const updated = await getProject();
  expect(updated.chartSpec.yDomain).toEqual(['5', '10']);
  expect(updated.frame).toEqual({ ...initial.frame, frame: '4:3', showBrand: false });
  expect(updated.dataset).toEqual(initial.dataset);
  expect(updated.revision).toBe(initial.revision + 1);
  await chart.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const restored = await getProject();
  expect(restored).toEqual({ ...initial, updatedAt: restored.updatedAt, revision: updated.revision + 1 });
  await chart.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const repeated = await getProject();
  expect(repeated).toEqual({ ...updated, updatedAt: repeated.updatedAt, revision: restored.revision + 1 });
  await otherChart.getByRole('button', { name: 'Edit chart mapping and frame' }).click();
  await otherChart.getByLabel('Title', { exact: true }).fill('Another tab’s chart');
  await otherChart.getByRole('button', { name: 'Review chart' }).click();
  await otherChart.getByRole('button', { name: 'Apply chart changes' }).click();
  await expect(otherChart.getByText('This project changed in another tab. Review the saved version before retrying.')).toBeVisible();
  await otherChart.getByRole('button', { name: 'Save as a separate chart' }).click();
  await expect(otherChart.getByText('Saved as a separate chart project.')).toBeVisible();
  const copy = JSON.parse(await download(otherPage, otherChart.getByRole('button', { name: 'Download chart project' })));
  expect(copy.id).not.toBe(initial.id);
  expect(copy.title).toBe('Another tab’s chart');
  expect(copy.dataset).toEqual(initial.dataset);
  expect(await getProject()).toEqual(repeated);
  await otherPage.close();
});

test('requires an explicit decimal and thousands separator for a localized data file', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Chart data file').setInputFiles({
    name: 'values.csv', mimeType: 'text/csv', buffer: Buffer.from('Team;Amount\nNorth;1.000,10\nNorth;0,20\n'),
  });
  await chart.getByLabel('Data format').selectOption(';');
  await chart.getByRole('button', { name: 'Read data' }).click();
  const amount = chart.getByRole('group', { name: 'Amount' });
  await amount.getByLabel('Type').selectOption('number');
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  await expect(chart.getByRole('alert')).toContainText('Use a supported exact decimal');
  await amount.getByLabel('Decimal separator').selectOption('comma');
  await amount.getByLabel('Thousands separator').selectOption('period');
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  await chart.getByLabel('Aggregation').selectOption('sum');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(chart.getByRole('table', { name: 'Displayed values' }).getByRole('cell', { name: '1000.3', exact: true })).toBeVisible();
  await chart.getByRole('button', { name: 'Create chart project' }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const body = await download(page, chart.getByRole('button', { name: 'Download chart project' }));
  expect(JSON.parse(body).dataset.rows.map((row: { cells: unknown[] }) => row.cells)).toEqual([['North', '1000.1'], ['North', '0.2']]);
  expect(body).not.toContain('1.000,10');
});

test('finds a later chart value, changes visible columns, and navigates rows in studio and offline HTML', async ({ page, browser }, info) => {
  const rows = Array.from({ length: 55 }, (_, index) => `Sample ${String(index + 1).padStart(2, '0')},${index + 1}`);
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Chart data file').setInputFiles({
    name: 'samples.csv', mimeType: 'text/csv', buffer: Buffer.from(['Sample,Count', ...rows, ''].join('\n')),
  });
  await chart.getByRole('button', { name: 'Read data' }).click();
  await chart.getByRole('group', { name: 'Count', exact: true }).getByLabel('Type').selectOption('number');
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  await chart.getByLabel('Title', { exact: true }).fill('Read chart values');
  await chart.getByLabel('Y field').selectOption({ label: 'Count' });
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await chart.getByRole('button', { name: 'Create chart project' }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();

  const controls = chart.getByRole('region', { name: 'Displayed values', exact: true });
  const table = controls.getByRole('table', { name: 'Displayed values' });
  await expect(table.getByRole('row')).toHaveCount(51);
  await controls.getByRole('button', { name: 'Next rows' }).click();
  await expect(controls.getByRole('status')).toContainText('Rows 51–55 of 55');
  const row51 = table.getByRole('row', { name: /Sample 51/ });
  await row51.focus();
  await row51.press('ArrowDown');
  await expect(table.getByRole('row', { name: /Sample 52/ })).toBeFocused();
  await expect(controls.getByRole('status')).toContainText('Focused row 52, Sample 52.');
  await controls.getByLabel('Find a value in displayed values').fill('Sample 54');
  await controls.getByText('Choose columns', { exact: true }).click();
  await controls.getByRole('checkbox', { name: 'Present values', exact: true }).uncheck();
  await expect(table.getByRole('columnheader', { name: 'Present values' })).toHaveCount(0);
  await expect(table.getByRole('row', { name: /Sample 54/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chart-table-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('chart-table-mobile.png') });

  const html = await download(page, chart.getByRole('button', { name: 'Download accessible HTML' }));
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const { createHash } = await import('node:crypto');
  expect(script).toBeDefined();
  expect(html).toContain(`script-src 'sha256-${createHash('sha256').update(script!).digest('base64')}'`);
  const context = await browser.newContext({ offline: true });
  try {
    const offline = await context.newPage();
    await offline.setContent(html);
    await offline.getByRole('searchbox', { name: 'Find a value in displayed values' }).fill('Sample 54');
    const result = offline.getByRole('table', { name: 'Displayed values, Rows 51–55 of 55' });
    const row = result.getByRole('row', { name: /Sample 54/ });
    await expect(row).toBeVisible();
    await expect(result.getByRole('row', { name: /Sample 53/ })).toHaveCount(0);
    await row.focus();
    await expect(offline.getByRole('status')).toContainText('Focused row 54, Sample 54.');
    await offline.getByText('Choose columns', { exact: true }).click();
    await offline.getByRole('checkbox', { name: 'Present values', exact: true }).uncheck();
    await expect(result.getByRole('columnheader', { name: 'Present values' })).toHaveCount(0);
    await expect(row).toBeVisible();
  } finally {
    await context.close();
  }
});

test('recovers an oversized typed dataset by explicitly excluding a column before creation', async ({ page }) => {
  const payload = 'Excluded field '.padEnd(1950, 'x');
  const rows = Array.from({ length: 760 }, () => `All,${payload},1`);
  const csv = Buffer.from(['Category,Notes,Value', ...rows].join('\n'));
  expect(csv.byteLength).toBeLessThan(2_000_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Chart data file').setInputFiles({ name: 'expanded.csv', mimeType: 'text/csv', buffer: csv });
  await chart.getByRole('button', { name: 'Read data' }).click();
  await chart.getByRole('group', { name: 'Value', exact: true }).getByLabel('Type').selectOption('number');
  const confirm = chart.getByRole('button', { name: 'Confirm columns' });
  await confirm.click();
  await expect(chart.getByRole('alert')).toContainText('confirmed dataset exceeds 1,500,000 bytes');
  await expect(chart.getByRole('button', { name: 'Create chart project' })).toHaveCount(0);
  const kept = chart.getByRole('group', { name: 'Notes', exact: true }).getByRole('checkbox', { name: 'Keep this column' });
  await kept.press('Space');
  await expect(kept).not.toBeChecked();
  await expect(chart.getByText('760 rows · 2 of 3 columns kept')).toBeVisible();
  await confirm.click();
  await chart.getByLabel('Title', { exact: true }).fill('Reduced data');
  await chart.getByLabel('Aggregation').selectOption('sum');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(chart.getByRole('table', { name: 'Displayed values' }).getByRole('row', { name: 'All 760 760 760 Included' })).toBeVisible();
  await chart.getByRole('button', { name: 'Create chart project' }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const saved = await download(page, chart.getByRole('button', { name: 'Download chart project' }));
  expect(saved).not.toMatch(/Excluded field|"Notes"/);
  const { dataset, revision } = JSON.parse(saved);
  expect(revision).toBe(0);
  expect(dataset.fields.map((field: { name: string }) => field.name)).toEqual(['Category', 'Value']);
  expect(dataset.rows.map((row: { cells: string[] }) => row.cells)).toEqual(rows.map(() => ['All', '1']));
});

test('round-trips exact chart data, series, transforms and domains through a fresh workspace', async ({ page, browser }) => {
  const base = JSON.parse(await readFile(new URL('../../src/lib/authoring/fixtures/example-chart.json', import.meta.url), 'utf8'));
  const day = '66666666-6666-4666-8666-666666666666';
  const value = '77777777-7777-4777-8777-777777777777';
  const series = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const include = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const fixture = {
    ...base,
    title: 'Exact weekly measures',
    dataset: {
      version: 1,
      fields: [
        { id: day, name: 'Day', type: 'date', unit: '' },
        { id: value, name: 'Measure', type: 'number', unit: 'seconds' },
        { id: series, name: 'Region', type: 'string', unit: '' },
        { id: include, name: 'Reviewed', type: 'boolean', unit: '' },
      ],
      rows: [
        ['2026-11-03', '0.25', 'Öst', true], ['2026-11-01', '0.1', 'Öst', true],
        ['2026-11-01', '0.2', 'Öst', true], ['2026-11-02', null, 'Öst', true],
        ['2026-11-02', '0.001', 'West', true], ['2026-11-03', '0.09', 'West', false],
      ].map((cells, index) => ({ id: `12222222-2222-4222-8222-22222222222${index}`, cells })),
    },
    chartSpec: {
      ...base.chartSpec, mark: 'line', xField: day, yField: value, seriesField: series,
      aggregation: 'mean', missing: 'gap', duplicateX: 'aggregate', ordering: 'ascending',
      xDomain: ['2026-11-01', '2026-11-03'], yDomain: ['0', '0.2'],
      filters: [{ fieldId: include, operator: 'eq', value: true }],
      description: 'Daily measurements by region. Reviewed rows are plotted.',
    },
  };
  const openImport = async (at: Page) => {
    await at.goto('/');
    await at.getByRole('button', { name: 'Build with guidance' }).click();
    await at.getByRole('button', { name: 'Chart values' }).click();
    return at.getByRole('dialog', { name: 'Chart values' });
  };
  const importProject = async (chart: Locator, body: string) => {
    await chart.getByLabel('Import a Meridian chart project').setInputFiles({
      name: 'weekly.meridian.json', mimeType: 'application/json', buffer: Buffer.from(body),
    });
    await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  };
  const chart = await openImport(page);
  await importProject(chart, JSON.stringify(fixture));
  const exportProject = (at: Page, dialog: Locator) =>
    download(at, dialog.getByRole('button', { name: 'Download chart project' }));
  const firstBytes = await exportProject(page, chart);
  const original = JSON.parse(firstBytes);
  expect(original).toEqual({ ...fixture, id: original.id, revision: 0, updatedAt: original.updatedAt });
  const table = chart.getByRole('table', { name: 'Displayed values' });
  await expect(table.getByRole('row', { name: '2026-11-01 0.15 Öst 2 2 Included' })).toBeVisible();
  await expect(table.getByRole('row', { name: '2026-11-03 0.25 Öst 1 1 Outside range' })).toBeVisible();

  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, acceptDownloads: true });
  try {
    const fresh = await context.newPage();
    const imported = await openImport(fresh);
    await importProject(imported, firstBytes);
    const copy = JSON.parse(await exportProject(fresh, imported));
    expect(copy.id).not.toBe(original.id);
    expect(authoredBytes(copy)).toBe(authoredBytes(original));
    await fresh.reload();
    await fresh.getByRole('button', { name: 'Manage projects' }).click();
    await fresh.getByRole('button', { name: 'Chart projects' }).click();
    const library = fresh.getByRole('dialog', { name: 'Chart projects' });
    await library.getByRole('button', { name: fixture.title, exact: true }).click();
    await expect(library.getByText('Chart saved in this browser.')).toBeVisible();
    expect(JSON.parse(await exportProject(fresh, library))).toEqual(copy);
    expect(await exportProject(page, chart)).toBe(firstBytes);
  } finally {
    await context.close();
  }

  function authoredBytes(project: typeof base) {
    const { id, revision, updatedAt, ...authored } = project;
    return JSON.stringify(authored);
  }
});
