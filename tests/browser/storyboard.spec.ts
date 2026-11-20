import { readFile } from 'node:fs/promises';
import { expect, test, type Download, type Page } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';
import type { StudioDocument } from '../../src/types';
import { continueProject, openExample, ready } from './helpers';

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
  const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
  if (await dismiss.isVisible()) await dismiss.click();
  await test.info().attach(name, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
}

async function importProject(page: Page, doc: StudioDocument) {
  await page.locator('input[type=file]').setInputFiles({ name: 'storyboard.meridian.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  // A cached render can keep its SVG ID. Wait for the imported document instead.
  await expect.poll(() => page.evaluate(key => {
    const workspace = JSON.parse(localStorage.getItem(key) || '{}');
    const active = workspace.documents?.find((item: { id: string }) => item.id === workspace.activeId);
    return JSON.stringify([active?.title, active?.source, active?.storyboard ?? null]);
  }, STORAGE_KEY)).toBe(JSON.stringify([doc.title, doc.source, doc.storyboard ?? null]));
  await ready(page);
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
  await openExample(page);
});

test('scene editing, sequencing and project persistence preserve the diagram source', async ({ page }) => {
  const doc = createDocument(); doc.source = SOURCE;
  await importProject(page, doc);
  await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
  const panel = page.locator('.sb-storyboard');
  await panel.getByRole('button', { name: 'Create first scene', exact: true }).click();
  await panel.getByLabel('Scene title', { exact: true }).fill('Opening');
  const duration = panel.getByRole('spinbutton', { name: /Duration/ });
  await duration.fill('');
  await expect(duration).toHaveValue('');
  await duration.fill('7.5');
  await duration.press('Enter');
  await expect(duration).toHaveValue('7.5');
  await duration.fill('1200');
  await duration.press('Escape');
  await expect(duration).toHaveValue('7.5');
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
  expect(exported.storyboard.scenes[2].duration).toBe(7.5);
  expect(new Set(exported.storyboard.scenes.map((scene: { id: string }) => scene.id)).size).toBe(3);
  await attachScreenshot(page, 'storyboard-desktop-authoring');
  await page.reload();
  await continueProject(page);
  await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
  await expect(panel.locator('.sb-scene')).toHaveCount(3);
  await expect(panel.getByLabel('Loop', { exact: true })).toBeChecked();
  await panel.getByRole('button', { name: 'Delete scene', exact: true }).click();
  await expect(panel.locator('.sb-scene')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(panel.locator('.sb-scene')).toHaveCount(3);
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
  await panel.getByRole('button', { name: 'Next scene', exact: true }).click();
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-preview', 'true');
  await expect(page.locator(NODE('gateway'))).toHaveCSS('opacity', '1');
  await expect(panel.getByLabel('Scene title', { exact: true })).toHaveValue('Follow the request');
  await expect(page.locator(FRAME)).not.toHaveAttribute('viewBox', original!);
  await panel.getByRole('button', { name: 'Previous scene', exact: true }).click();
  await expect(panel.getByLabel('Scene title', { exact: true })).toHaveValue('Start with the client');
  await panel.getByLabel('Storyboard playhead', { exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-scene', 'route');
  await expect(panel.getByLabel('Scene title', { exact: true })).toHaveValue('Follow the request');
  await expect(page.locator(NODE('gateway'))).toHaveCSS('opacity', '1');
  await expect(page.locator(NODE('client'))).toHaveCSS('opacity', '0.26');
  await expect(page.locator(FRAME)).not.toHaveAttribute('viewBox', original!);
  await expect(page.locator(`${FRAME} [data-story-flow]`).first()).toHaveCSS('display', 'inline');
  await attachScreenshot(page, 'storyboard-focused-scene-preview');
  await panel.getByRole('button', { name: 'Play storyboard', exact: true }).click();
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-playing', 'true');
  await expect(panel.getByLabel('Scene title', { exact: true })).toBeDisabled();
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
  await expect(page.locator(NODE('gateway'))).toHaveCSS('opacity', '1');
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-preview', 'true');
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
    await expect(svg).toHaveAttribute('data-story-preview', 'true');
    await expect(presentation.locator('[data-element-key="node:gateway"]')).toHaveCSS('opacity', '1');
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
  await panel.getByRole('button', { name: 'Next scene', exact: true }).click();
  await panel.getByRole('button', { name: 'Preview this scene', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Canvas', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator(FRAME)).toBeVisible();
  await expect(page.locator(FRAME)).toHaveAttribute('data-story-scene', 'route');
  await expect(page.locator(NODE('gateway'))).toHaveCSS('opacity', '1');
  const moving = await page.locator(`${FRAME} [data-story-flow]`).evaluateAll(paths => paths.filter(path => getComputedStyle(path).display !== 'none').length);
  expect(moving).toBe(0);
  await attachScreenshot(page, 'storyboard-mobile-reduced-motion-scene');
  await page.getByRole('button', { name: 'Story', exact: true }).click();
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator(FRAME)).toBeVisible();
  await page.getByRole('button', { name: 'Pause presentation', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Story', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(panel).toBeVisible();
});

test('target selection stays bounded and missing-reference cleanup is reversible', async ({ page }) => {
  const doc = createDocument(); doc.title = 'Target controls';
  doc.source = `flowchart LR\n${Array.from({ length: 70 }, (_, index) => `  n${index}[Node ${index}]`).join('\n')}`;
  const scene = createScene();
  scene.visible = ['node:gone']; scene.highlight = ['node:gone']; scene.flow = ['edge:gone']; scene.camera.keys = ['node:gone'];
  doc.storyboard = { version: 1, loop: false, scenes: [scene] };
  await importProject(page, doc);
  await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
  const panel = page.locator('.sb-storyboard');
  const picker = panel.getByRole('group', { name: 'Visible elements', exact: true });
  await expect(picker.locator('.sb-element-row')).toHaveCount(40);
  await expect(panel.getByRole('group', { name: 'Camera targets', exact: true })).toHaveCount(0);
  await expect(panel.locator('.sb-missing')).toContainText('2 missing targets');
  await panel.getByRole('button', { name: 'Remove missing targets', exact: true }).click();
  await expect(panel.locator('.sb-missing')).toHaveCount(0);
  await picker.getByLabel('Search visible elements', { exact: true }).fill('Node 69');
  await expect(picker.locator('.sb-element-row')).toHaveCount(1);
  await picker.getByRole('checkbox', { name: 'Node 69', exact: true }).check();
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(panel.locator('.sb-missing')).toContainText('2 missing targets');
  const exported = JSON.parse((await exportFile(page, 'project')).toString('utf8'));
  expect(exported.source).toBe(doc.source);
  expect(exported.storyboard.scenes[0].visible).toEqual(['node:n69', 'node:gone']);
  expect(exported.storyboard.scenes[0].highlight).toEqual(['node:gone']);
  await attachScreenshot(page, 'storyboard-target-reconciliation');
});

test('wide heading text wraps within its actual SVG frame', async ({ page }) => {
  const doc = createDocument(); doc.source = SOURCE; doc.title = 'W'.repeat(100); doc.subtitle = 'W'.repeat(160);
  await importProject(page, doc);
  const headings = page.locator(`${FRAME} [data-frame-label]`);
  await expect(headings.first()).toBeVisible();
  const geometry = await headings.evaluateAll((labels, padding) => labels.map(label => {
    const text = label as SVGTextElement;
    const frame = text.closest('svg[data-meridian-export]')!;
    const box = text.getBBox();
    return { right: box.x + box.width, limit: Number(frame.getAttribute('width')) - padding, left: box.x };
  }), doc.settings.padding);
  expect(geometry.length).toBeGreaterThan(3);
  expect(geometry.every(box => box.left >= doc.settings.padding - 1 && box.right <= box.limit + 1)).toBe(true);
});
