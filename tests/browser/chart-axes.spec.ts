import { expect, test } from '@playwright/test';

test('reviews a scaled numeric X axis and keeps clipped values in the table', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Build with guidance' }).click();
  await page.getByRole('button', { name: 'Chart values' }).click();
  const chart = page.getByRole('dialog', { name: 'Chart values' });
  await chart.getByLabel('Chart data file').setInputFiles({
    name: 'distances.csv', mimeType: 'text/csv', buffer: Buffer.from('Distance,Time\n1000,2\n2500,5\n'),
  });
  await chart.getByRole('button', { name: 'Read data' }).click();
  for (const name of ['Distance', 'Time']) {
    await chart.getByRole('group', { name, exact: true }).getByLabel('Type').selectOption('number');
  }
  await chart.getByRole('button', { name: 'Confirm columns' }).click();
  await chart.getByLabel('Chart type').selectOption('scatter');
  await chart.getByLabel('Y field').selectOption({ label: 'Time' });
  await chart.getByLabel('Scale X values').check();
  await chart.getByLabel('X multiplier').selectOption('-3');
  await chart.getByLabel('X unit label').fill('km');
  await chart.getByLabel('Set a custom X range').check();
  await chart.getByLabel('X minimum').fill('0');
  await chart.getByLabel('X maximum').fill('2');
  await chart.getByRole('button', { name: 'Review chart' }).click();
  const displayed = chart.getByRole('table', { name: 'Displayed values' });
  await expect(displayed.getByRole('columnheader', { name: 'Distance (× 10^-3 · km)' })).toBeVisible();
  await expect(displayed.getByRole('row', { name: '2.5 5 1 1 Outside range' })).toBeVisible();
  await chart.getByRole('button', { name: 'Source data', exact: true }).click();
  await expect(chart.getByRole('table', { name: 'Source data' }).getByRole('cell', { name: '2500', exact: true })).toBeVisible();
});
