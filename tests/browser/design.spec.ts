import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { continueProject, DRAWING, openExample, ready } from './helpers';

const SOURCE = 'flowchart LR\n  subgraph network[Network]\n    alpha[Client] -->|Request| beta[Service]\n  end\n  beta --> store[(Data)]';

async function source(page: Page, value: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(value);
  await ready(page);
}
async function choose(page: Page, key: string) {
  expect(key, 'Choose an actual source element, not a decorative hit path').toBeTruthy();
  await page.getByLabel('Inspect an element', { exact: true }).selectOption(key);
  await expect(page.getByLabel('Inspect an element', { exact: true })).toHaveValue(key);
  await expect(page.getByRole('region', { name: 'Selected element properties' })).toBeVisible();
}

async function openSection(page: Page, title: string) {
  const section = page.locator('.mi-inspector details').filter({ has: page.locator('summary').getByText(title, { exact: true }) });
  if (await section.getAttribute('open') === null) await section.locator('summary').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/'); await openExample(page); await source(page, SOURCE);
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
  await openSection(page, 'Typography');
  await page.getByLabel('Font', { exact: true }).selectOption('serif');
  await page.getByLabel('Element font size', { exact: true }).fill('24');
  await ready(page);
  await expect.poll(() => page.locator(`${DRAWING} [data-element-key="node:alpha"] text`).first().evaluate(el => getComputedStyle(el).fontSize)).toBe('24px');
  await expect.poll(() => page.locator('.cm-line').allTextContents()).toEqual(SOURCE.split('\n'));
  await expect(page.locator('.saved-state')).toHaveText('Saved locally');
  await page.reload(); await continueProject(page);
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
    return { start: item?.getAttribute('marker-start'), end: item?.getAttribute('marker-end'), stroke: item ? getComputedStyle(item).stroke : undefined };
  }, key!);
  expect(markers.start).toBeTruthy(); expect(markers.end).toBeTruthy(); expect(markers.stroke).toBe('rgb(255, 153, 51)');
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
  await expect(page.getByRole('button', { name: 'Porcelain', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Executive\b/ })).not.toBeVisible();
  await test.info().attach('diagram-styling-overview', { body: await page.screenshot(), contentType: 'image/png' });
  await openSection(page, 'Design presets');
  for (const name of ['Executive', 'Infrastructure', 'Cyberpunk', 'Minimal', 'Technical Blueprint']) {
    const button = page.getByRole('button', { name: new RegExp(`^${name}\\b`) });
    await button.click(); await expect(button).toHaveAttribute('aria-pressed', 'true'); await ready(page);
    await expect(page.locator(`${DRAWING} [data-element-kind="node"]`)).toHaveCount(3);
    await expect(page.locator(`${DRAWING} [data-element-kind="group"]`)).toHaveCount(1);
  }
  await openSection(page, 'Connections & layout');
  await page.getByRole('button', { name: 'Refine layout', exact: true }).click(); await ready(page);
  const key = await page.locator(`${DRAWING} path[data-element-kind="edge"]`).first().getAttribute('data-element-key');
  await choose(page, key!);
  await expect(page.getByLabel('Route shape', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Diagram', exact: true }).click();
  await openSection(page, 'Connections & layout');
  await page.getByLabel('Layout engine', { exact: true }).selectOption('dagre'); await ready(page);
  await choose(page, key!);
  await expect(page.getByLabel('Route shape', { exact: true })).toBeEnabled();
  await page.getByLabel('Route shape', { exact: true }).selectOption('orthogonal'); await ready(page);
  await expect(page.locator('.source-error')).toHaveCount(0);
});

test('inherited source values are accurate and property resets preserve unrelated overrides', async ({ page }) => {
  const authored = `${SOURCE}\n  style alpha fill:#24686b,color:#f1f5f9,stroke:#7da0a4,stroke-width:2.3px,font-size:18px\n  linkStyle 0 stroke:#7799aa,stroke-width:1.6px`;
  await source(page, authored); await choose(page, 'node:alpha');
  await expect(page.getByLabel('Element fill', { exact: true })).toHaveValue('#24686b');
  await openSection(page, 'Typography');
  await expect(page.getByLabel('Element font size', { exact: true })).toHaveValue('18');
  await expect(page.getByLabel('Element font size value', { exact: true })).toHaveValue('18');
  await page.getByLabel('Element font size value', { exact: true }).fill('22'); await ready(page);
  await page.getByLabel('Fill hex color', { exact: true }).fill('#abcdef');
  await page.getByLabel('Fill hex color', { exact: true }).press('Enter'); await ready(page);
  await page.getByRole('button', { name: 'Reset element font size to inherited', exact: true }).click(); await ready(page);
  await expect(page.getByLabel('Element font size', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Element font size', { exact: true })).toHaveValue('18');
  await expect(page.getByLabel('Element fill', { exact: true })).toHaveValue('#abcdef');
  await expect(page.locator(`${DRAWING} [data-element-key="node:alpha"] text`).first()).toHaveCSS('font-size', '18px');
  await page.getByRole('button', { name: 'Reset fill to inherited', exact: true }).click(); await ready(page);
  await expect(page.getByLabel('Element fill', { exact: true })).toHaveValue('#24686b');
  await page.getByLabel('Fill hex color', { exact: true }).fill('#zzzzzz');
  await page.getByLabel('Fill hex color', { exact: true }).press('Enter');
  await expect(page.getByLabel('Fill hex color', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator(`${DRAWING} [data-element-key="node:alpha"] > rect`)).toHaveCSS('fill', 'rgb(36, 104, 107)');
  await page.getByLabel('Fill hex color', { exact: true }).press('Escape');
  await expect(page.getByLabel('Fill hex color', { exact: true })).toHaveValue('#24686b');
  const edge = await page.locator(`${DRAWING} path[data-element-kind="edge"]`).first().getAttribute('data-element-key');
  await choose(page, edge!);
  await expect(page.getByLabel('Element line weight', { exact: true })).toHaveValue('1.6');
  await expect(page.getByLabel('Element line weight value', { exact: true })).toHaveValue('1.6');
  await page.getByLabel('Element line weight value', { exact: true }).fill('2.3'); await ready(page);
  await page.getByRole('button', { name: 'Reset element line weight to inherited', exact: true }).click(); await ready(page);
  await expect(page.getByLabel('Element line weight', { exact: true })).toHaveValue('1.6');
  await expect.poll(() => page.locator('.cm-line').allTextContents()).toEqual(authored.split('\n'));
  await test.info().attach('inherited-connector-controls', { body: await page.screenshot(), contentType: 'image/png' });
});

test('group typography preserves authored borders and unlabeled connectors explain text availability', async ({ page }) => {
  const authored = `${SOURCE}\n  style network fill:#123456,stroke:#aabbcc,stroke-width:2.3px`;
  await source(page, authored); await choose(page, 'group:network');
  await openSection(page, 'Typography');
  await page.getByLabel('Element font size', { exact: true }).fill('22'); await ready(page);
  const group = page.locator(`${DRAWING} [data-element-key="group:network"]`);
  await expect(group.locator(':scope > rect')).toHaveCSS('fill', 'rgb(18, 52, 86)');
  await expect(group.locator(':scope > rect')).toHaveCSS('stroke', 'rgb(170, 187, 204)');
  await expect(group.locator(':scope > rect')).toHaveCSS('stroke-width', '2.3px');
  await expect(group.locator('text').first()).toHaveCSS('font-size', '22px');
  await expect(page.locator(`${DRAWING} path[data-element-kind="edge"]`)).toHaveCount(2);
  await expect(page.locator(`${DRAWING} [data-edge-hit][data-element-kind]`)).toHaveCount(0);
  const unlabeled = await page.locator(`${DRAWING} path[data-element-kind="edge"][data-element-key]`).nth(1).getAttribute('data-element-key');
  await choose(page, unlabeled!);
  await expect.poll(() => page.locator('.mi-inspector-scroll').evaluate(element => element.scrollTop)).toBe(0);
  await expect(page.getByLabel('Element text color', { exact: true })).toHaveCount(0);
  await expect(page.locator('.mi-inspector summary').getByText('Typography', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Add a connector label in the source to style its text.', { exact: true })).toBeVisible();
  await openSection(page, 'Emphasis & effects');
  await expect(page.getByLabel('Element shadow', { exact: true })).not.toBeChecked();
  await page.getByLabel('Element glow', { exact: true }).check(); await ready(page);
  await expect(page.getByLabel('Element shadow', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Reset element glow to inherited', exact: true }).click(); await ready(page);
  await expect(page.getByLabel('Element glow', { exact: true })).not.toBeChecked();
  await expect.poll(() => page.locator('.cm-line').allTextContents()).toEqual(authored.split('\n'));
});
