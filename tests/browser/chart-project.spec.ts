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
    buffer: Buffer.from('[{"Team":"North","Requests":0.1},{"Team":"North","Requests":0.2},{"Team":"South","Requests":null}]'),
  });
  await chart.getByRole('button', { name: 'Read data' }).click();
  const requests = chart.getByRole('group', { name: 'Requests' });
  await requests.getByLabel('Type').selectOption('number');
  await requests.getByLabel('Unit').fill('requests');
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  await chart.getByLabel('Title', { exact: true }).fill('Requests by team');
  await chart.getByLabel('Aggregation').selectOption('sum');
  await chart.getByRole('button', { name: 'Save data draft' }).click();
  await expect(chart.getByText('Typed data and mapping draft saved in this browser.')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  await chart.getByRole('button', { name: 'Resume Requests by team' }).click();
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
