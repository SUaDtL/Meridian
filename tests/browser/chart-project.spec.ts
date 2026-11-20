import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing chart download.');
  return readFile(path, 'utf8');
}

test('confirms typed file data, reviews an exact aggregate, saves, reopens, and exports accessible HTML', async ({ page }, info) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Chart data file').setInputFiles({
    name: 'team.json', mimeType: 'application/json',
    buffer: Buffer.from('[{"Team":"North","Requests":0.1},{"Team":"North","Requests":0.2},{"Team":"South","Requests":"pending"}]'),
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
  await chart.getByLabel('Aggregation').selectOption('sum');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(conversion).toContainText('Requests · 1 invalid · 0 empty');
  await chart.getByRole('button', { name: 'Back to mapping' }).click();
  await chart.getByRole('button', { name: 'Save data draft' }).click();
  await expect(chart.getByText('Typed data and mapping draft saved in this browser.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  await chart.getByRole('button', { name: 'Resume Requests by team' }).click();
  await expect(chart.getByText(/The restored draft uses the reviewed missing-value rules/)).toBeVisible();
  await expect(chart.getByLabel('Aggregation')).toHaveValue('sum');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(chart.getByRole('img', { name: 'Requests by team' })).toBeVisible();
  const table = chart.getByRole('table', { name: 'Displayed values' });
  await expect(table.getByRole('row', { name: 'North 0.3 2 2 Included' })).toBeVisible();
  await expect(table.getByRole('row', { name: 'South Missing 1 0 Missing Y' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chart-review-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chart.getByRole('img', { name: 'Requests by team' })).toBeVisible();
  await page.screenshot({ path: info.outputPath('chart-review-mobile.png') });
  await chart.getByRole('button', { name: 'Create chart project' }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const initial = JSON.parse(await download(page, chart.getByRole('button', { name: 'Download chart project' })));
  expect(initial).toMatchObject({
    schema: 'meridian-chart/v1', documentKind: 'chart',
    dataset: { rows: [{ cells: ['North', '0.1'] }, { cells: ['North', '0.2'] }, { cells: ['South', null] }] },
    chartSpec: { mark: 'bar', aggregation: 'sum' },
  });
  expect(initial).not.toHaveProperty('source');

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
  await expect(page.getByRole('table', { name: /Displayed values/ }).getByRole('cell', { name: '0.3' })).toBeVisible();
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
