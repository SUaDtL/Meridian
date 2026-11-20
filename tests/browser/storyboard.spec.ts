import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { createDocument } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';
import type { StudioDocument } from '../../src/types';

const SOURCE = 'flowchart LR\n    client[Client] --> gateway[Gateway]\n    gateway --> store[(Store)]';
const FRAME = '[data-testid="rendered-diagram"] > svg[data-meridian-export]';
const NODE = (id: string) => `${FRAME} [data-element-key="node:${id}"]`;

async function bytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  if (!path) throw new Error('Missing download path.');
  return readFile(path);
}

async function attachScreenshot(page: Page, name: string) {
  await test.info().attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
}

async function importProject(page: Page, doc: StudioDocument) {
  const prior = await page.locator(`${FRAME} [data-meridian="diagram"]`).getAttribute('id').catch(() => null);
  await page.locator('input[type=file]').setInputFiles({ name: 'storyboard.meridian.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await expect.poll(async () => {
    const current = await page.locator(`${FRAME} [data-meridian="diagram"]`).getAttribute('id').catch(() => null);
    return Boolean(current && current !== prior);
  }).toBe(true);
  await expect(page.locator(NODE('client'))).toBeVisible();
  await expect(page.locator('.render-status')).toHaveCount(0);
  await expect(page.locator('.saved-state')).toContainText('Saved locally');
}

async function exportFile(page: Page, kind: 'project' | 'HTML') {
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: kind === 'project' ? /^Project/ : /^HTML\b/ }).click();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name: `Download ${kind}`, exact: true }).click();
  const content = await bytes(await pending);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  return content;
}

async function fixture(page: Page) {
  const doc = createDocument();
  doc.title = 'From client to service'; doc.source = SOURCE; doc.settings.motion = 'none';
  await importProject(page, doc);
  const edge = await page.locator(`${FRAME} [data-element-key^="edge:"]`).first().getAttribute('data-element-key');
  expect(edge).toBeTruthy();
  const opening = { ...createScene(0), id: 'opening', title: 'Start with the client', duration: 1.5, transition: 0, visible: ['node:client'] };
  const route = { ...createScene(1), id: 'route', title: 'Follow the request', duration: 2.5, transition: 0.4, visible: null, highlight: ['node:gateway'], flow: [edge!], camera: { mode: 'elements' as const, keys: ['node:gateway'], padding: 28 } };
  doc.storyboard = { version: 1, loop: false, scenes: [opening, route] };
  await importProject(page, doc);
  return doc;
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator(FRAME)).toBeVisible();
  await expect(page.locator('.render-status')).toHaveCount(0);
});

test('scene editing, sequencing and project persistence preserve the diagram source', async ({ page }) => {
  const doc = createDocument(); doc.source = SOURCE;
  await importProject(page, doc);
  await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
  const panel = page.locator('.sb-storyboard');
  await panel.getByRole('button', { name: 'Create first scene', exact: true }).click();
  await panel.getByLabel('Scene title', { exact: true }).fill('Opening');
  await panel.getByLabel(/Duration/).fill('2');
  await panel.locator('.sb-heading').getByRole('button', { name: 'Add scene', exact: true }).click();
  await panel.getByLabel('Scene title', { exact: true }).fill('Route walkthrough');
  await panel.getByRole('button', { name: 'Move scene earlier', exact: true }).click();
  await expect(panel.locator('.sb-scene').first()).toContainText('Route walkthrough');
  await panel.getByRole('button', { name: 'Duplicate scene', exact: true }).click();
  await expect(panel.locator('.sb-scene')).toHaveCount(3);
  await panel.getByLabel('Loop', { exact: true }).check();
  const exported = JSON.parse((await exportFile(page, 'project')).toString('utf8'));
  expect(exported.source).toBe(SOURCE);
  expect(exported.storyboard.loop).toBe(true);
  expect(exported.storyboard.scenes.map((scene: { title: string }) => scene.title)).toEqual(['Route walkthrough', 'Route walkthrough copy', 'Opening']);
  expect(new Set(exported.storyboard.scenes.map((scene: { id: string }) => scene.id)).size).toBe(3);
  await attachScreenshot(page, 'storyboard-desktop-authoring');
  await page.reload();
  await expect(page.locator(FRAME)).toBeVisible();
  await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
  await expect(panel.locator('.sb-scene')).toHaveCount(3);
  await expect(panel.getByLabel('Loop', { exact: true })).toBeChecked();
  await panel.getByRole('button', { name: 'Delete scene', exact: true }).click();
  await expect(panel.locator('.sb-scene')).toHaveCount(2);
});

test('preview, timeline, camera, flow and portable HTML use the same offline playback', async ({ page, browser }) => {
  test.setTimeout(90_000);
  const doc = await fixture(page);
  const original = await page.locator(FRAME).getAttribute('viewBox');
  await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
  const panel = page.locator('.sb-storyboard');
  await panel.getByRole('button', { name: 'Preview this scene', exact: true }).click();
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-scene', 'opening');
  await expect(page.locator(NODE('client'))).toHaveCSS('opacity', '1');
  await expect(page.locator(NODE('gateway'))).toHaveCSS('opacity', '0');
  await expect(page.locator(NODE('gateway'))).toHaveAttribute('tabindex', '-1');
  await expect(page.locator(NODE('client'))).toHaveAttribute('tabindex', '-1');
  await page.locator(NODE('client')).click();
  await expect(page.locator('.selection-toolbar')).toHaveCount(0);
  await panel.getByLabel('Storyboard playhead', { exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-scene', 'route');
  await expect(page.locator(NODE('gateway'))).toHaveCSS('opacity', '1');
  await expect(page.locator(NODE('client'))).toHaveCSS('opacity', '0.26');
  await expect(page.locator(FRAME)).not.toHaveAttribute('viewBox', original!);
  await expect(page.locator(`${FRAME} [data-story-flow]`).first()).toHaveCSS('display', 'inline');
  await attachScreenshot(page, 'storyboard-focused-scene-preview');
  await panel.getByRole('button', { name: 'Play storyboard', exact: true }).click();
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-playing', 'true');
  await panel.getByRole('button', { name: 'Pause storyboard', exact: true }).click();
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-playing', 'false');
  await panel.getByRole('button', { name: 'End storyboard preview', exact: true }).click();
  await expect(page.locator(FRAME)).not.toHaveAttribute('data-story-scene');
  await expect(page.locator(FRAME)).toHaveAttribute('viewBox', original!);
  await expect(page.locator(NODE('gateway'))).toHaveCSS('opacity', '1');
  await expect(page.locator(NODE('gateway'))).toHaveAttribute('tabindex', '0');
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-playing', 'true');
  await page.locator('.presentation-controls').getByRole('button', { name: 'Pause presentation', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-playing', 'false');
  await page.locator('[data-testid="diagram-viewport"]').click({ position: { x: 20, y: 90 } });
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-scene', 'route');
  await attachScreenshot(page, 'storyboard-desktop-presentation-controls');
  await page.keyboard.press('Escape');
  await expect(page.locator('.presentation-controls')).toHaveCount(0);
  await expect(page.locator(FRAME)).not.toHaveAttribute('data-story-scene');
  const html = (await exportFile(page, 'HTML')).toString('utf8');
  expect(html).toContain("script-src 'sha256-");
  const context = await browser.newContext({ offline: true, viewport: { width: 1400, height: 900 } });
  try {
    const presentation = await context.newPage();
    const errors: string[] = [];
    presentation.on('pageerror', error => errors.push(error.message));
    await presentation.setContent(html);
    const svg = presentation.locator('main > svg');
    await expect(svg).toHaveAttribute('data-story-scene', 'opening');
    await expect(presentation.locator('[data-element-key="node:gateway"]')).toHaveCSS('opacity', '0');
    await presentation.getByLabel('Choose scene', { exact: true }).selectOption('1');
    await expect(svg).toHaveAttribute('data-story-scene', 'route');
    await expect(svg).toHaveAttribute('data-story-playing', 'false');
    await presentation.getByLabel('Choose scene', { exact: true }).selectOption('0');
    await expect(svg).toHaveAttribute('data-story-scene', 'opening');
    await presentation.getByLabel('Presentation playhead', { exact: true }).focus();
    await presentation.keyboard.press('End');
    await expect(svg).toHaveAttribute('data-story-scene', 'route');
    await expect(presentation.locator('#scene-title')).toHaveText(doc.storyboard!.scenes[1].title);
    await expect(presentation.locator('[data-element-key="node:gateway"]')).toHaveCSS('opacity', '1');
    await expect(presentation.locator('[data-story-flow]').first()).toHaveCSS('display', 'inline');
    await attachScreenshot(presentation, 'storyboard-offline-presentation');
    await presentation.getByRole('button', { name: 'Replay', exact: true }).click();
    await expect(svg).toHaveAttribute('data-story-playing', 'true');
    await presentation.getByLabel('Presentation playhead', { exact: true }).focus();
    await presentation.keyboard.press('End');
    await expect(svg).toHaveAttribute('data-story-playing', 'false');
    await presentation.getByRole('button', { name: 'Replay', exact: true }).click();
    await presentation.getByRole('button', { name: 'Pause presentation', exact: true }).click();
    await expect(svg).toHaveAttribute('data-story-playing', 'false');
    await expect(presentation.locator('script[src], link[rel=stylesheet]')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('mobile storyboard remains usable and reduced motion shows scene state without moving flow', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  const panel = page.locator('.sb-storyboard');
  await expect(panel).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await attachScreenshot(page, 'storyboard-mobile-authoring');
  await panel.getByRole('button', { name: 'Preview this scene', exact: true }).click();
  await panel.getByRole('button', { name: 'Next scene', exact: true }).click();
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-scene', 'route');
  await expect(page.locator(NODE('gateway'))).toHaveCSS('opacity', '1');
  const moving = await page.locator(`${FRAME} [data-story-flow]`).evaluateAll(paths => paths.filter(path => getComputedStyle(path).display !== 'none').length);
  expect(moving).toBe(0);
  await attachScreenshot(page, 'storyboard-mobile-reduced-motion-scene');
});
