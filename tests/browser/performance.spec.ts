import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DRAWING, openExample, ready } from './helpers';

interface Work { layouts: number; decorations: number; svgParses: number; }
type MeasuredWindow = Window & { __meridianWork: Work; __meridianDiagram?: Element | null };

async function measureWork(page: Page) {
  await page.addInitScript(() => {
    const work = { layouts: 0, decorations: 0, svgParses: 0 };
    (window as MeasuredWindow).__meridianWork = work;
    const parse = DOMParser.prototype.parseFromString;
    DOMParser.prototype.parseFromString = function (input, type) {
      if (type === 'image/svg+xml') work.svgParses++;
      return parse.call(this, input, type);
    };
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const kind = node.getAttribute('data-meridian-render');
        if (kind === 'layout') work.layouts++;
        if (kind === 'decoration') work.decorations++;
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const work = (page: Page) => page.evaluate(() => ({ ...(window as MeasuredWindow).__meridianWork }));

test('welcome downloads only its small entry graph and does not initialize a diagram or editor', async ({ page, request }) => {
  await measureWork(page);
  const receipt = await (await request.get('/build.json')).json();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Browse examples', exact: true })).toBeVisible();
  await expect(page.locator(DRAWING)).toHaveCount(0);
  await expect(page.locator('.cm-editor')).toHaveCount(0);
  expect(await work(page)).toEqual({ layouts: 0, decorations: 0, svgParses: 0 });
  const paths = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => new URL(entry.name).pathname).filter(path => path.endsWith('.js')));
  const assets = receipt.assets as Array<{ path: string; bytes: number }>;
  const loaded = assets.filter(asset => paths.some(path => path.endsWith('/' + asset.path)));
  const initialJsBytes = loaded.reduce((total, asset) => total + asset.bytes, 0);
  const totalJsBytes = assets.filter(asset => asset.path.endsWith('.js')).reduce((total, asset) => total + asset.bytes, 0);
  expect(initialJsBytes).toBeGreaterThan(0);
  expect(initialJsBytes).toBeLessThan(500_000);
  expect(initialJsBytes / totalJsBytes).toBeLessThan(0.15);
  expect(loaded.every(asset => receipt.initialAssets.includes(asset.path))).toBe(true);
  expect(paths.some(path => /\/(?:Studio|SourceEditor|mermaid)[-.]/i.test(path))).toBe(false);
  await test.info().attach('welcome-payload', { contentType: 'application/json', body: JSON.stringify({ initialJsBytes, totalJsBytes, fraction: initialJsBytes / totalJsBytes, loaded }, null, 2) });
});

test('framing skips the renderer; motion reuses layout; returning to a style uses the result cache', async ({ page }) => {
  await measureWork(page);
  await page.goto('/'); await openExample(page);
  await page.getByRole('group', { name: 'Style scope', exact: true }).getByRole('button', { name: 'Diagram', exact: true }).click();
  const flow = page.getByRole('group', { name: 'Connection effect', exact: true }).getByRole('button', { name: 'Flow', exact: true });
  if (await flow.getAttribute('aria-pressed') !== 'true') { await flow.click(); await ready(page); }
  const baseline = await work(page);
  const originalId = await page.locator(DRAWING).getAttribute('id');
  const accessibility = await page.context().newCDPSession(page);
  try {
    await expect.poll(async () => {
      const tree = await accessibility.send('Accessibility.getFullAXTree');
      return tree.nodes.filter(node => !node.ignored && node.role?.value === 'button').map(node => node.name?.value);
    }).toEqual(expect.arrayContaining(['Edit diagram title', 'Edit diagram subtitle']));
    const tree = await accessibility.send('Accessibility.getFullAXTree');
    const nodeLabel = await page.locator(`${DRAWING} [data-element-key][role="button"]`).first().getAttribute('aria-label');
    expect(nodeLabel).toBeTruthy();
    expect(tree.nodes.some(node => !node.ignored && node.role?.value === 'button' && node.name?.value === nodeLabel)).toBe(true);
  } finally { await accessibility.detach(); }

  await page.getByRole('button', { name: 'Edit diagram title', exact: true }).click();
  const heading = page.getByRole('dialog', { name: 'Edit heading', exact: true });
  await heading.getByRole('textbox', { name: /^Title/ }).fill('A clearer direction');
  await heading.getByRole('textbox', { name: /^Subtitle/ }).fill('Changed directly on the stage');
  await heading.getByRole('button', { name: 'Apply heading', exact: true }).click();
  await expect(page.locator('[data-frame-label="title"]').first()).toHaveText('A clearer direction');
  const headed = await work(page);
  expect(headed.layouts).toBe(baseline.layouts);
  expect(headed.decorations).toBe(baseline.decorations);

  await page.getByText('Canvas & frame', { exact: true }).click();
  await page.getByRole('group', { name: 'Frame aspect ratio', exact: true }).getByRole('button', { name: /^Square/ }).click();
  await expect.poll(() => page.locator('[data-meridian-export]').evaluate(svg => svg.getAttribute('width') === svg.getAttribute('height'))).toBe(true);
  const framed = await work(page);
  expect(framed.layouts).toBe(baseline.layouts);
  expect(framed.decorations).toBe(baseline.decorations);

  await page.getByRole('group', { name: 'Connection effect', exact: true }).getByRole('button', { name: 'Pulse', exact: true }).click();
  await expect(page.locator(`${DRAWING} .meridian-motion`).first()).toHaveAttribute('stroke-dasharray', '12 88');
  await ready(page);
  const decorated = await work(page);
  expect(decorated.layouts).toBe(baseline.layouts);
  expect(decorated.decorations - baseline.decorations).toBe(1);
  expect(await page.locator(DRAWING).getAttribute('id')).toBe(originalId);

  await flow.click();
  await expect(page.locator(`${DRAWING} .meridian-motion`).first()).toHaveAttribute('stroke-dasharray', '2 23');
  await ready(page);
  const cached = await work(page);
  expect(cached.layouts).toBe(decorated.layouts);
  expect(cached.decorations).toBe(decorated.decorations);

  await page.getByTitle('Actual size', { exact: true }).click();
  const position = page.locator('.drawing-position');
  await expect.poll(() => position.evaluate(element => (element as HTMLElement).style.transform.endsWith('scale(1)'))).toBe(true);
  await page.getByRole('button', { name: 'Pan canvas', exact: true }).click();
  const viewport = await page.getByTestId('diagram-viewport').boundingBox();
  expect(viewport).toBeTruthy();
  const start = { x: viewport!.x + viewport!.width * 0.65, y: viewport!.y + viewport!.height * 0.65 };
  const unpanned = await position.evaluate(element => (element as HTMLElement).style.transform);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 70, start.y + 40, { steps: 5 }); await page.mouse.up();
  // Camera state is intentionally committed on animation frames. Let the final
  // pointer frame paint before recording the view that presentation must restore.
  await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await expect.poll(() => position.evaluate(element => (element as HTMLElement).style.transform)).not.toBe(unpanned);
  const editingCamera = await position.evaluate(element => (element as HTMLElement).style.transform);
  await page.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(page.locator('.studio')).toHaveClass(/is-presenting/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.studio')).not.toHaveClass(/is-presenting/);
  await expect.poll(() => position.evaluate(element => (element as HTMLElement).style.transform)).toBe(editingCamera);
  expect(await work(page)).toEqual(cached);
  await test.info().attach('render-work-counts', { contentType: 'application/json', body: JSON.stringify({ baseline, headed, framed, decorated, cached }, null, 2) });
});

test('storyboard edits and playback retain the same stage DOM without reparsing SVG', async ({ page }) => {
  await measureWork(page);
  await page.goto('/'); await openExample(page);
  const baseline = await work(page);
  await page.locator(DRAWING).evaluate(element => { (window as MeasuredWindow).__meridianDiagram = element; });
  await page.getByRole('button', { name: 'Storyboard', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Presentation storyboard', exact: true });
  await panel.getByRole('button', { name: 'Create first scene', exact: true }).click();
  await panel.getByLabel('Scene title', { exact: true }).fill('A clear opening');
  await expect(panel.getByLabel('Scene title', { exact: true })).toHaveValue('A clear opening');
  await expect(page.locator('.saved-state')).toContainText('Saved locally');
  expect(await work(page)).toEqual(baseline);
  await panel.getByRole('button', { name: 'Play storyboard', exact: true }).click();
  await expect.poll(async () => Number(await panel.getByLabel('Storyboard playhead', { exact: true }).inputValue())).toBeGreaterThan(0.3);
  await panel.getByRole('button', { name: 'Pause storyboard', exact: true }).click();
  expect(await work(page)).toEqual(baseline);
  expect(await page.locator(DRAWING).evaluate(element => element === (window as MeasuredWindow).__meridianDiagram)).toBe(true);
  await test.info().attach('storyboard-work-counts', { contentType: 'application/json', body: JSON.stringify({ before: baseline, after: await work(page) }, null, 2) });
});

test('portable application still opens and renders without a server or runtime network assets', async ({ page }) => {
  const network: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.route(/^https?:/, route => route.abort());
  await page.goto(pathToFileURL(resolve('standalone/Meridian.html')).href);
  await expect(page.getByRole('button', { name: 'Browse examples', exact: true })).toBeVisible();
  await openExample(page);
  await expect(page.locator(DRAWING)).toBeVisible();
  expect(network).toEqual([]);
});
