import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const DRAWING = '[data-testid="rendered-diagram"] svg[data-meridian="diagram"]';
const SOURCE = 'flowchart LR\n  subgraph network[Network]\n    alpha[Client] -->|Request| beta[Service]\n  end\n  beta --> store[(Data)]';

async function ready(page: Page) {
  await expect(page.locator(DRAWING)).toBeVisible();
  await expect(page.locator('.render-status')).toHaveCount(0);
}
async function source(page: Page, value: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(value);
  await ready(page);
}
async function choose(page: Page, key: string) {
  await page.getByRole('button', { name: 'Look', exact: true }).click();
  await page.getByLabel('Inspect an element', { exact: true }).selectOption(key);
  await expect(page.getByRole('region', { name: 'Selected element properties' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await ready(page); await source(page, SOURCE);
  await expect(page.locator(`${DRAWING} [data-element-key="node:alpha"]`)).toBeVisible();
});

test('node shape, measured typography and colors survive refresh without rewriting Mermaid', async ({ page }) => {
  await page.locator(`${DRAWING} [data-element-key="node:alpha"]`).click();
  await expect(page.getByLabel('Node shape', { exact: true })).toBeVisible();
  await page.getByLabel('Node shape', { exact: true }).selectOption('diamond');
  await ready(page);
  await expect(page.locator(`${DRAWING} [data-element-key="node:alpha"] polygon`)).toBeVisible();
  await page.getByLabel('Element fill', { exact: true }).fill('#255c72');
  await page.getByLabel('Element text color', { exact: true }).fill('#ffffff');
  await page.getByLabel('Font', { exact: true }).selectOption('serif');
  await page.getByLabel('Element font size', { exact: true }).fill('24');
  await ready(page);
  await expect.poll(() => page.locator(`${DRAWING} [data-element-key="node:alpha"] text`).first().evaluate(el => getComputedStyle(el).fontSize)).toBe('24px');
  await expect.poll(() => page.locator('.cm-line').allTextContents()).toEqual(SOURCE.split('\n'));
  await expect(page.locator('.saved-state')).toHaveText('Saved locally');
  await page.reload(); await ready(page);
  await choose(page, 'node:alpha');
  await expect(page.getByLabel('Node shape', { exact: true })).toHaveValue('diamond');
  await expect(page.getByLabel('Element fill', { exact: true })).toHaveValue('#255c72');
  await expect(page.getByLabel('Element font size', { exact: true })).toHaveValue('24');
  await page.getByRole('button', { name: 'Reset element styling', exact: true }).click();
  await ready(page);
  await expect(page.getByLabel('Node shape', { exact: true })).toHaveValue('');
  await expect.poll(() => page.locator('.cm-line').allTextContents()).toEqual(SOURCE.split('\n'));
});

test('connector and group overrides use stable identities and are included in project downloads', async ({ page }) => {
  const edge = page.locator(`${DRAWING} path[data-element-kind="edge"]`).first();
  const key = await edge.getAttribute('data-element-key');
  expect(key).toBeTruthy();
  await choose(page, key!);
  await page.getByLabel('Element stroke', { exact: true }).fill('#ff9933');
  await page.getByLabel('Arrowheads', { exact: true }).selectOption('both');
  await page.getByLabel('Element line style', { exact: true }).selectOption('dashed');
  await ready(page);
  const decorated = page.locator(`${DRAWING} path[data-element-key]`);
  const markers = await decorated.evaluateAll((items, selected) => {
    const item = items.find(el => el.getAttribute('data-element-key') === selected);
    return { start: item?.getAttribute('marker-start'), end: item?.getAttribute('marker-end'), stroke: (item as SVGElement | undefined)?.style.stroke };
  }, key!);
  expect(markers.start).toBeTruthy(); expect(markers.end).toBeTruthy(); expect(markers.stroke).toBe('#ff9933');
  await choose(page, 'group:network');
  await page.getByLabel('Element fill', { exact: true }).fill('#294635');
  await ready(page);
  await expect(page.locator(`${DRAWING} [data-element-key="group:network"] > rect`)).toHaveCSS('fill', 'rgb(41, 70, 53)');
  const modified = SOURCE.replace('  subgraph', '  unrelated[Other] --> extra[Elsewhere]\n  subgraph');
  await source(page, modified); await ready(page);
  await choose(page, key!);
  await expect(page.getByLabel('Element stroke', { exact: true })).toHaveValue('#ff9933');
  await expect(page.getByLabel('Arrowheads', { exact: true })).toHaveValue('both');
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('ControlOrMeta+s');
  const download = await downloadPromise, path = await download.path();
  const project = JSON.parse(await readFile(path!, 'utf8'));
  expect(project.source).toBe(modified);
  expect(project.schema).toBe('meridian/v2');
  expect(project.design.elements[key!].arrowhead).toBe('both');
  expect(project.design.elements['group:network'].fill).toBe('#294635');
});

test('all five design presets render; layout refinements and unsupported controls are honest', async ({ page }) => {
  for (const name of ['Executive', 'Infrastructure', 'Cyberpunk', 'Minimal', 'Technical Blueprint']) {
    const button = page.getByRole('button', { name: new RegExp(`^${name}\\b`) });
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true'); await ready(page);
    await expect(page.locator(`${DRAWING} [data-element-kind="node"]`)).toHaveCount(3);
    await expect(page.locator(`${DRAWING} [data-element-kind="group"]`)).toHaveCount(1);
  }
  await page.getByRole('button', { name: 'Refine layout', exact: true }).click(); await ready(page);
  const key = await page.locator(`${DRAWING} path[data-element-kind="edge"]`).first().getAttribute('data-element-key');
  await choose(page, key!);
  await expect(page.getByLabel('Route shape', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Look', exact: true }).click();
  await page.getByText('Connections & layout', { exact: true }).click();
  await page.getByLabel('Layout engine', { exact: true }).selectOption('dagre'); await ready(page);
  await choose(page, key!);
  await expect(page.getByLabel('Route shape', { exact: true })).toBeEnabled();
  await page.getByLabel('Route shape', { exact: true }).selectOption('orthogonal'); await ready(page);
  await expect(page.locator('.source-error')).toHaveCount(0);
});
