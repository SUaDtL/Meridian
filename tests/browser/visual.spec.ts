import { expect, test, type Page } from '@playwright/test';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { THEMES } from '../../src/lib/themes';
import { TEMPLATES } from '../../src/lib/templates';
import { openExample } from './helpers';

const DRAWING = '[data-testid="rendered-diagram"] svg[data-meridian="diagram"]';
const LEGACY_URL = process.env.PLAYWRIGHT_REFERENCE_URL || 'http://127.0.0.1:4174';

async function ready(page: Page) {
  await expect(page.locator(DRAWING)).toBeVisible();
  await expect(page.locator('.render-status')).toHaveCount(0);
}

async function selectTheme(page: Page, theme: string) {
  const before = await page.locator(DRAWING).getAttribute('id');
  const button = page.getByRole('button', { name: theme, exact: true });
  if (await button.getAttribute('aria-pressed') === 'true') return;
  await button.click();
  await expect.poll(() => page.locator(DRAWING).getAttribute('id')).not.toBe(before);
  await ready(page);
}

async function normalizedPicture(page: Page): Promise<Buffer> {
  const svg = await page.locator('[data-meridian-export]').evaluate((element) => element.outerHTML);
  const picture = await page.context().newPage();
  try {
    // The original compiled app is the fixed reference. Both pictures use the
    // same browser and fonts; panel layout cannot change picture dimensions.
    await picture.setViewportSize({ width: 1100, height: 1600 });
    await picture.setContent(`<style>body{margin:0;background:#fff}body>svg{display:block;width:1000px;height:auto}*{animation:none!important;transition:none!important}</style>${svg}`);
    return await picture.locator('body > svg').screenshot({ animations: 'disabled' });
  } finally { await picture.close(); }
}

async function comparePictures(candidate: Page, reference: Page, label: string) {
  const currentBuffer = await normalizedPicture(candidate);
  const originalBuffer = await normalizedPicture(reference);
  const current = PNG.sync.read(currentBuffer);
  const original = PNG.sync.read(originalBuffer);
  await test.info().attach(`${label}-current`, { body: currentBuffer, contentType: 'image/png' });
  await test.info().attach(`${label}-published-reference`, { body: originalBuffer, contentType: 'image/png' });
  expect(current.width).toBe(original.width);
  expect(current.height).toBe(original.height);
  const diff = new PNG({ width: current.width, height: current.height });
  const changed = pixelmatch(current.data, original.data, diff.data, current.width, current.height, { threshold: 0.15 });
  const ratio = changed / (current.width * current.height);
  if (ratio > 0.002) {
    await test.info().attach(`${label}-difference`, { body: PNG.sync.write(diff), contentType: 'image/png' });
  }
  expect(ratio, `${label}: default diagram appearance diverged from the published reference`).toBeLessThanOrEqual(0.002);
}

test('all six themes retain their published visual appearance', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  try {
    const reference = await context.newPage();
    await page.goto('/'); await reference.goto(LEGACY_URL);
    await openExample(page); await ready(reference);
    for (const theme of THEMES) {
      await test.step(theme.name, async () => {
        await selectTheme(page, theme.name); await selectTheme(reference, theme.name);
        await comparePictures(page, reference, `theme-${theme.id}`);
      });
    }
  } finally { await context.close(); }
});

test('every diagram family retains its published geometry and rendering', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' });
  try {
    const reference = await context.newPage();
    await page.goto('/'); await reference.goto(LEGACY_URL);
    await openExample(page); await ready(reference);
    for (const template of TEMPLATES) {
      await test.step(template.title, async () => {
        for (const target of [page, reference]) {
          await target.getByRole('button', { name: 'Examples', exact: true }).click();
          await target.locator('.example-card').filter({ has: target.getByRole('heading', { name: template.title, exact: true }) }).click();
          await expect(target.getByRole('dialog')).toHaveCount(0);
          await ready(target);
        }
        await comparePictures(page, reference, `family-${template.id}`);
      });
    }
  } finally { await context.close(); }
});
