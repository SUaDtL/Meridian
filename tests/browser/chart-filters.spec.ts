import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('reviews typed filters and explains excluded rows while preserving source data', async ({ page }) => {
  const fixture = await readFile(new URL('../../src/lib/authoring/fixtures/example-chart.json', import.meta.url));
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Import a Meridian chart project').setInputFiles({ name: 'example.meridian.json', mimeType: 'application/json', buffer: fixture });
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  await chart.getByRole('button', { name: 'Edit chart mapping and frame' }).click();
  await chart.getByText('Data filters (0)', { exact: true }).click();
  await chart.getByLabel('Filter column').selectOption({ label: 'Requests' });
  await chart.getByLabel('Filter comparison').selectOption('gte');
  await chart.getByLabel('Filter value').fill('10.0');
  await chart.getByRole('button', { name: 'Add filter' }).click();
  await chart.getByRole('button', { name: 'Review chart' }).click();
  await expect(chart.getByText(/Rows excluded by filters: 1/).filter({ visible: true })).toBeVisible();
  await expect(chart.getByRole('table', { name: 'Displayed values' }).getByRole('cell', { name: 'South' })).toHaveCount(0);
  await chart.getByRole('button', { name: 'Source data', exact: true }).click();
  await expect(chart.getByRole('table', { name: 'Source data' }).getByRole('row', { name: 'South Missing Excluded by filter 1' })).toBeVisible();
  await chart.getByRole('button', { name: 'Apply chart changes' }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  const [file] = await Promise.all([page.waitForEvent('download'), chart.getByRole('button', { name: 'Download chart project' }).click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing chart project.');
  const project = JSON.parse(await readFile(path, 'utf8'));
  expect(project.dataset).toEqual(JSON.parse(fixture.toString('utf8')).dataset);
  expect(project.chartSpec.filters).toEqual([{ fieldId: project.chartSpec.yField, operator: 'gte', value: '10' }]);
  await chart.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(chart.getByText('Chart saved in this browser.')).toBeVisible();
  await chart.getByRole('button', { name: 'Displayed values', exact: true }).click();
  await expect(chart.getByRole('table', { name: 'Displayed values' }).getByRole('cell', { name: 'South' })).toBeVisible();
});

test('requires explicit filtering above the mark caps and draws every observation at each cap', async ({ page }) => {
  const rows = Array.from({ length: 2001 }, (_, index) => `${index + 1},${(index % 31) - 15}`);
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Chart data file').setInputFiles({
    name: 'mark-limits.csv', mimeType: 'text/csv', buffer: Buffer.from(['X,Y', ...rows].join('\n')),
  });
  await chart.getByRole('button', { name: 'Read data' }).click();
  for (const field of ['X', 'Y']) await chart.getByRole('group', { name: field, exact: true }).getByLabel('Type').selectOption('number');
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  await chart.getByLabel('Title', { exact: true }).fill('Reviewed mark limits');
  const review = chart.getByRole('button', { name: 'Review chart' });
  const mark = chart.getByLabel('Chart type');
  const figure = chart.getByRole('img', { name: 'Reviewed mark limits' });

  async function setLimit(cutoff: string) {
    const filter = chart.getByRole('group', { name: 'Filter retained rows' });
    if (!(await filter.isVisible())) await chart.getByText(/^Data filters \(\d+\)$/).click();
    const remove = filter.getByRole('button', { name: 'Remove filter 1' });
    if (await remove.isVisible()) await remove.click();
    await filter.getByLabel('Filter column').selectOption({ label: 'X' });
    await filter.getByLabel('Filter comparison').selectOption('lte');
    await filter.getByLabel('Filter value').fill(cutoff);
    await filter.getByRole('button', { name: 'Add filter' }).click();
  }

  await mark.selectOption('scatter');
  await chart.getByLabel('Y field').selectOption({ label: 'Y' });
  await review.click();
  await expect(chart.getByRole('alert')).toContainText('up to 2,000 observations');
  await expect(figure).toHaveCount(0);
  await setLimit('2000');
  await review.click();
  await expect(figure.locator('circle')).toHaveCount(2000);
  await expect(figure).toHaveAccessibleDescription(/2000 observations from 2000 retained rows of 2001 input rows/);

  await chart.getByRole('button', { name: 'Back to mapping' }).click();
  await mark.selectOption('line');
  await chart.getByLabel('Y field').selectOption({ label: 'Y' });
  await review.click();
  await expect(chart.getByRole('alert')).toContainText('up to 500 observations');
  await expect(figure).toHaveCount(0);
  await setLimit('500');
  await review.click();
  await expect(figure.locator('circle')).toHaveCount(500);
  await expect(figure).toHaveAccessibleDescription(/500 observations from 500 retained rows of 2001 input rows/);
});
