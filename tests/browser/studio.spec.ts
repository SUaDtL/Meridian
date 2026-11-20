import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { TEMPLATES } from '../../src/lib/templates';

const DRAWING = '[data-testid="rendered-diagram"] svg[data-meridian="diagram"]';
const SIMPLE_SOURCE = 'flowchart LR\n    alpha[Client] --> beta[Gateway]\n    beta --> gamma[(Store)]';

async function renderId(page: Page): Promise<string | null> {
  return page.locator(DRAWING).getAttribute('id');
}

async function ready(page: Page): Promise<void> {
  await expect(page.locator(DRAWING)).toBeVisible();
  await expect(page.locator('.render-status')).toHaveCount(0);
}

async function setSource(page: Page, source: string): Promise<void> {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(source);
}

async function bytes(download: Download): Promise<Buffer> {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error('Playwright did not provide a local download path.');
  return readFile(path);
}

test.beforeEach(async ({ page }) => {
  // Each test starts in an isolated Playwright context, so it cannot alter a
  // developer's existing projects or rely on prior browser-local workspace data.
  await page.goto('/');
  await ready(page);
});

test('every shipped example renders a dimensioned, safe SVG; flowchart nodes remain selectable', async ({ page }) => {
  test.setTimeout(120_000);
  for (const template of TEMPLATES) {
    await test.step(template.title, async () => {
      const previous = await renderId(page);
      await page.getByRole('button', { name: 'Examples', exact: true }).click();
      await page.locator('.example-card').filter({ has: page.getByRole('heading', { name: template.title, exact: true }) }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(async () => page.locator(DRAWING).getAttribute('id').catch(() => null)).not.toBe(previous);
      await ready(page);
      const geometry = await page.locator('[data-meridian-export]').evaluate((svg) => ({
        width: Number(svg.getAttribute('width')),
        height: Number(svg.getAttribute('height')),
        title: svg.querySelector(':scope > title')?.textContent,
        unsafe: svg.querySelectorAll('script, foreignObject, image, a[href]').length,
      }));
      expect(geometry.width).toBeGreaterThan(0);
      expect(geometry.height).toBeGreaterThan(0);
      expect(Number.isFinite(geometry.width * geometry.height)).toBe(true);
      expect(geometry.title).toBe(template.title);
      expect(geometry.unsafe).toBe(0);
      if (template.source.startsWith('flowchart')) {
        const nodes = page.locator(`${DRAWING} [data-node-key]`);
        expect(await nodes.count()).toBeGreaterThan(0);
        await nodes.first().click();
        await expect(page.locator('.selection-toolbar')).toBeVisible();
        await expect(nodes.first()).toHaveAttribute('aria-pressed', 'true');
        await page.getByRole('button', { name: 'Clear selected node', exact: true }).click();
      }
    });
  }
});

test('invalid source preserves the last valid diagram and blocks stale picture export, then recovers', async ({ page }) => {
  const previous = await renderId(page);
  const count = await page.locator(`${DRAWING} [data-node-key]`).count();
  await setSource(page, 'flowchart LR\n    broken[An unfinished node');
  await expect(page.locator('.render-status.error')).toContainText('Showing last valid diagram');
  expect(await renderId(page)).toBe(previous);
  await expect(page.locator(`${DRAWING} [data-node-key]`)).toHaveCount(count);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Download PNG', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: /^Project/ }).click();
  await expect(dialog.getByRole('button', { name: 'Download project', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await setSource(page, SIMPLE_SOURCE);
  await expect(page.locator(`${DRAWING} [data-node-key="alpha"]`)).toBeVisible();
  await ready(page);
  await expect(page.locator(`${DRAWING} [data-node-key]`)).toHaveCount(3);
  expect(await renderId(page)).not.toBe(previous);
});

test('source and selected theme survive an actual page reload', async ({ page }) => {
  await setSource(page, SIMPLE_SOURCE);
  await expect(page.locator(`${DRAWING} [data-node-key="alpha"]`)).toBeVisible();
  const previous = await renderId(page);
  await page.getByRole('button', { name: 'Porcelain', exact: true }).click();
  await expect.poll(() => renderId(page)).not.toBe(previous);
  await ready(page);
  await expect(page.getByRole('button', { name: 'Porcelain', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.saved-state')).toHaveText('Saved locally');
  await page.reload();
  await ready(page);
  await expect(page.locator('.cm-content')).toContainText('alpha[Client]');
  await expect(page.locator(`${DRAWING} [data-node-key="alpha"]`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Porcelain', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.canvas-theme-name')).toHaveText('Porcelain');
});

test('SVG and PNG downloads have valid dimensions; exported HTML works offline with pause and replay', async ({ page, browser }) => {
  test.setTimeout(90_000);
  await page.getByRole('button', { name: 'Flow', exact: true }).click();
  await ready(page);
  let svgWidth = 0;
  let svgHeight = 0;
  let html = '';
  for (const format of ['SVG', 'PNG', 'HTML'] as const) {
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: new RegExp(`^${format}\\b`) }).click();
    if (format === 'PNG') await dialog.getByRole('combobox', { name: /^Resolution/ }).selectOption('2');
    const downloadPromise = page.waitForEvent('download');
    await dialog.getByRole('button', { name: `Download ${format}`, exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
    const content = await bytes(download);
    await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    if (format === 'SVG') {
      const metadata = await page.evaluate((xml) => {
        const parsed = new DOMParser().parseFromString(xml, 'image/svg+xml');
        return {
          error: Boolean(parsed.querySelector('parsererror')),
          width: Number(parsed.documentElement.getAttribute('width')),
          height: Number(parsed.documentElement.getAttribute('height')),
          motion: parsed.querySelectorAll('[data-studio-motion], animate, animateMotion').length,
          selected: parsed.querySelectorAll('.studio-selected, .studio-dimmed').length,
        };
      }, content.toString('utf8'));
      expect(metadata.error).toBe(false);
      expect(metadata.motion).toBe(0);
      expect(metadata.selected).toBe(0);
      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);
      svgWidth = metadata.width; svgHeight = metadata.height;
    } else if (format === 'PNG') {
      expect(content.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const width = content.readUInt32BE(16);
      const height = content.readUInt32BE(20);
      expect(width).toBe(Math.floor(svgWidth * 2));
      expect(height).toBe(Math.floor(svgHeight * 2));
      expect(width * height).toBeLessThanOrEqual(32_000_000);
    } else html = content.toString('utf8');
  }
  const offline = await browser.newContext({ offline: true, viewport: { width: 1400, height: 900 } });
  try {
    const presentation = await offline.newPage();
    await presentation.setContent(html);
    await expect(presentation.locator('main > svg')).toBeVisible();
    await expect(presentation.locator('script[src], link[rel="stylesheet"]')).toHaveCount(0);
    expect(await presentation.locator('[data-studio-motion]').count()).toBeGreaterThan(0);
    await presentation.getByRole('button', { name: 'Pause motion', exact: true }).click();
    await expect(presentation.locator('body')).toHaveClass('paused');
    await presentation.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(presentation.locator('body')).not.toHaveClass('paused');
    await expect(presentation.getByRole('button', { name: 'Pause motion', exact: true })).toBeVisible();
  } finally { await offline.close(); }
});

test('downloaded projects round-trip through the real file import control', async ({ page }) => {
  await setSource(page, SIMPLE_SOURCE);
  await expect(page.locator(`${DRAWING} [data-node-key="alpha"]`)).toBeVisible();
  await ready(page);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Project/ }).click();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download project', exact: true }).click();
  const download = await pending;
  const data = await bytes(download);
  const project = JSON.parse(data.toString('utf8'));
  expect(project.source).toBe(SIMPLE_SOURCE);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'round-trip.meridian.json', mimeType: 'application/json', buffer: data });
  await expect(page.locator('.toast[role="status"]')).toContainText('Imported');
  await ready(page);
  await expect(page.locator('.cm-content')).toContainText('alpha[Client]');
  await expect.poll(() => page.evaluate(originalId => {
    const workspace = JSON.parse(localStorage.getItem('meridian:v2') || '{}');
    return Boolean(workspace.activeId && workspace.activeId !== originalId);
  }, project.id)).toBe(true);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('meridian:v2') || '{}'));
  const imported = stored.documents.find((item: { id: string }) => item.id === stored.activeId);
  expect(imported.id).not.toBe(project.id);
  expect(imported.source).toBe(project.source);
  expect(imported.settings).toEqual(project.settings);
});

test('mobile panels and reduced-motion presentation remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await ready(page);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.getByRole('button', { name: 'Style', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Porcelain', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Porcelain', exact: true }).click();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await ready(page);
  await expect(page.locator('.canvas-theme-name')).toHaveText('Porcelain');
  await page.keyboard.press('p');
  await expect(page.locator('.studio')).toHaveClass(/is-presenting/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio')).not.toHaveClass(/is-presenting/);
  const animations = await page.locator(DRAWING).evaluate((element) => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length);
  expect(animations).toBe(0);
});
