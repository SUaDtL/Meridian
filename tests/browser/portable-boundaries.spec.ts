import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

async function download(page: Page, button: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), button.click()]);
  const path = await file.path();
  if (!path) throw new Error('Missing portable project download.');
  return readFile(path);
}

async function migrationReview(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  return page.getByRole('dialog', { name: 'Project migration and recovery' });
}

function projectFile(name: string, buffer: Buffer) {
  return { name: `${name}.meridian.json`, mimeType: 'application/json', buffer };
}

test('accepts and reimports a two-million-byte Mermaid project with exact Unicode source and annotations', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const fixture = JSON.parse(await readFile(new URL('../../src/lib/authoring/fixtures/example-project.json', import.meta.url), 'utf8'));
  const title = 'Unicode portable diagram';
  const head = '\uFEFFflowchart LR\r\n  A["Client 📦"]\r\n  B["API"]\r\n  A e1@--> B\r\n';
  const comment = `  %% ${'界'.repeat(980)}\r\n`;
  const comments = comment.repeat(Math.floor((100_000 - head.length - 7) / comment.length));
  const source = `${head}${comments}  %% ${'📦'.repeat(Math.floor((100_000 - head.length - comments.length - 7) / 2))}`.padEnd(99_998, '界') + '\r\n';
  expect(source.length).toBe(100_000);
  const orphans = Array.from({ length: 500 }, () => ({
    id: crypto.randomUUID(), formerElementId: null, legacyKey: '', reason: 'missing', retained: { role: 'service' },
  }));
  const project = { ...fixture, title, revision: 0, source, identity: { ...fixture.identity, orphans } };
  let remaining = 2_000_000 - Buffer.byteLength(JSON.stringify(project, null, 2));
  for (const orphan of orphans) {
    const emoji = Math.min(Math.floor(remaining / 4), 1000);
    const ascii = Math.min(remaining - emoji * 4, 1000 - emoji, 3);
    orphan.legacyKey = '📦'.repeat(emoji) + 'x'.repeat(ascii);
    remaining -= emoji * 4 + ascii;
    if (!remaining) break;
  }
  expect(remaining).toBe(0);
  const bytes = Buffer.from(JSON.stringify(project, null, 2));
  expect(bytes.length).toBe(2_000_000);

  const first = await migrationReview(page);
  const file = first.getByLabel('Import v3 project file');
  await file.setInputFiles(projectFile('over-limit', Buffer.concat([bytes, Buffer.from(' ')])));
  await expect(first.getByRole('alert')).toContainText(/2 MB|2,000,000/);
  await expect(first.getByRole('button', { name: /Open v3 project/ })).toHaveCount(0);
  await file.setInputFiles(projectFile('at-limit', bytes));
  const open = first.getByRole('button', { name: `Open v3 project ${title}` });
  await open.click();
  const accepted = page.getByRole('dialog', { name: title, exact: true });
  await expect(accepted.getByRole('img', { name: `Diagram preview for ${title}` })).toBeVisible();
  const exported = await download(page, accepted.getByRole('button', { name: 'Download v3 project' }));
  expect(exported.length).toBe(bytes.length);
  const materialized = JSON.parse(exported.toString());
  expect(exported.equals(Buffer.from(JSON.stringify({ ...project, id: materialized.id }, null, 2)))).toBe(true);

  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin, acceptDownloads: true });
  try {
    const destination = await fresh.newPage();
    const second = await migrationReview(destination);
    await second.getByLabel('Import v3 project file').setInputFiles(projectFile('portable-maximum', exported));
    const reexported = await download(destination, second.getByRole('button', { name: `Download v3 copy of ${title}` }));
    const reopened = JSON.parse(reexported.toString());
    expect(reopened.id).not.toBe(materialized.id);
    expect(reexported.equals(Buffer.from(JSON.stringify({ ...materialized, id: reopened.id }, null, 2)))).toBe(true);
  } finally { await fresh.close(); }
});

test('keeps unmatched Unicode code units in the project download and refuses a lossy Mermaid file', async ({ page, browser }) => {
  const fixture = JSON.parse(await readFile(new URL('../../src/lib/authoring/fixtures/example-project.json', import.meta.url), 'utf8'));
  const title = 'Exact Unicode source recovery';
  const source = '\uFEFFflowchart LR\r\n  A["Client 📦"]\r\n  B["API"]\r\n  A e1@--> B\r\n  %% "\\" \uD800 | \uDC00 | \uFFFD\r\n';
  const project = { ...fixture, title, source, revision: 0 };
  const migration = await migrationReview(page);
  await migration.getByLabel('Import v3 project file').setInputFiles(projectFile('unicode', Buffer.from(JSON.stringify(project))));
  await migration.getByRole('button', { name: `Open v3 project ${title}` }).click();
  const live = page.getByRole('dialog', { name: title, exact: true });
  await expect(live.getByRole('img', { name: `Diagram preview for ${title}` })).toBeVisible();
  await live.getByRole('button', { name: 'Export diagram', exact: true }).click();
  const choices = page.getByRole('dialog', { name: 'Take your diagram with you.' });
  await choices.getByRole('button', { name: /^Mermaid Plain/ }).click();
  await expect(choices.getByRole('button', { name: 'Download MERMAID' })).toBeDisabled();
  await expect(choices.getByRole('status')).toContainText('Download the project to preserve it exactly.');
  await choices.getByRole('button', { name: /^Project Editable/ }).click();
  const exported = await download(page, choices.getByRole('button', { name: 'Download project', exact: true }));
  const accepted = JSON.parse(exported.toString('utf8'));
  expect(accepted.source).toBe(source);
  expect(exported).toEqual(Buffer.from(JSON.stringify({ ...project, id: accepted.id }, null, 2)));
  expect(exported.toString('utf8')).toContain('\\ud800 | \\udc00 | �');

  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin, acceptDownloads: true });
  try {
    const target = await fresh.newPage();
    const review = await migrationReview(target);
    await review.getByLabel('Import v3 project file').setInputFiles(projectFile('recovered', exported));
    const reexported = await download(target, review.getByRole('button', { name: `Download v3 copy of ${title}` }));
    const recovered = JSON.parse(reexported.toString('utf8'));
    expect(recovered.id).not.toBe(accepted.id);
    expect(reexported).toEqual(Buffer.from(JSON.stringify({ ...accepted, id: recovered.id }, null, 2)));
  } finally { await fresh.close(); }
});

test('reopens a chart with the maximum rows, cells and serialized typed dataset', async ({ page, browser }) => {
  test.setTimeout(75_000);
  const fixture = JSON.parse(await readFile(new URL('../../src/lib/authoring/fixtures/example-chart.json', import.meta.url), 'utf8'));
  const title = 'Maximum typed dataset';
  const chartSpec = { ...fixture.chartSpec, aggregation: 'sum', duplicateX: 'aggregate' };
  const fields = [...fixture.dataset.fields, ...Array.from({ length: 8 }, (_, index) => ({
    id: crypto.randomUUID(), name: `Supplementary note ${index + 1}`, type: 'string', unit: '',
  }))];
  const rows = Array.from({ length: 10_000 }, (_, index) => ({
    id: crypto.randomUUID(), cells: [index % 2 ? 'East' : 'West', '1', ...Array<null | string>(8).fill(null)] as (string | null)[],
  }));
  const dataset = { version: 1, fields, rows };
  let remaining = 1_500_000 - jsonBytes(dataset);
  for (const row of rows) {
    const emoji = Math.min(Math.floor((remaining + 2) / 4), 1998);
    const ascii = Math.min(remaining + 2 - emoji * 4, 1999 - emoji, 3);
    row.cells[2] = '📦'.repeat(emoji) + 'x'.repeat(ascii);
    remaining -= emoji * 4 + ascii - 2; // The string replaces a four-byte null literal.
    if (!remaining) break;
  }
  expect(jsonBytes(dataset)).toBe(1_500_000);
  expect(rows.reduce((sum, row) => sum + row.cells.length, 0)).toBe(100_000);
  const project = { ...fixture, title, chartSpec, dataset };
  const input = Buffer.from(JSON.stringify(project));
  expect(input.length).toBeLessThan(2_000_000);

  async function openChart(target: Page) {
    await target.goto('/');
    await target.getByRole('button', { name: 'Build with guidance' }).click();
    await target.getByRole('button', { name: 'Chart values' }).click();
    return target.getByRole('dialog', { name: 'Chart values' });
  }
  const first = await openChart(page);
  const file = first.getByLabel('Import a Meridian chart project');
  const invalid = structuredClone(project);
  invalid.dataset.rows[0].cells[2] += 'x';
  expect(jsonBytes(invalid.dataset)).toBe(1_500_001);
  await file.setInputFiles(projectFile('dataset-over-limit', Buffer.from(JSON.stringify(invalid))));
  await expect(first.getByRole('alert')).toContainText('The confirmed dataset exceeds 1,500,000 bytes.');
  await file.setInputFiles(projectFile('dataset-at-limit', input));
  await expect(first.getByRole('img', { name: title })).toBeVisible();
  const exported = await download(page, first.getByRole('button', { name: 'Download chart project' }));
  const saved = JSON.parse(exported.toString());
  expect(exported.equals(Buffer.from(JSON.stringify({ ...project, id: saved.id, revision: 0, updatedAt: saved.updatedAt })))).toBe(true);

  const fresh = await browser.newContext({ baseURL: new URL(page.url()).origin, acceptDownloads: true });
  try {
    const destination = await fresh.newPage();
    const second = await openChart(destination);
    await second.getByLabel('Import a Meridian chart project').setInputFiles(projectFile('portable-data-maximum', exported));
    await expect(second.getByRole('img', { name: title })).toBeVisible();
    const reexported = await download(destination, second.getByRole('button', { name: 'Download chart project' }));
    const reopened = JSON.parse(reexported.toString());
    expect(reopened.id).not.toBe(saved.id);
    expect(reexported.equals(Buffer.from(JSON.stringify({ ...saved, id: reopened.id, updatedAt: reopened.updatedAt })))).toBe(true);
  } finally { await fresh.close(); }
});
