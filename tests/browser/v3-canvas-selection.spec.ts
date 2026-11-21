import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';

test.use({ hasTouch: true });

test('selects measured nodes by pointer and touch through the normal rename and connection review', async ({ page }, info) => {
  const source = '\uFEFFflowchart LR\r\n  A[Client]\r\n  B[Service]\r\n  C[Archive]\r\n  A first@--> B\r\n  B second@--> C\r\n';
  const project = { ...createDocument(), title: 'Select diagram nodes', subtitle: 'A frame with a title and subtitle', source };
  project.settings.frame = '16:9';
  await page.addInitScript(({ key, project }) => {
    localStorage.setItem(key, JSON.stringify({ version: 2, activeId: project.id, documents: [project] }));
    const images = new Map<string, Blob>();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      const url = create(blob);
      if (blob instanceof Blob && blob.type === 'image/svg+xml') images.set(url, blob);
      return url;
    };
    (window as Window & { canvasFixtureImages: Map<string, Blob> }).canvasFixtureImages = images;
  }, { key: STORAGE_KEY, project });
  await page.goto('/');
  await page.getByRole('button', { name: 'Manage projects' }).click();
  await page.getByRole('button', { name: 'Project migration and recovery' }).click();
  await page.getByRole('button', { name: 'Prepare v3 copies' }).click();
  await page.getByRole('button', { name: 'Open v3 project Select diagram nodes' }).click();
  const live = page.getByRole('dialog', { name: project.title });
  const canvas = live.getByRole('region', { name: 'Diagram canvas' });
  const image = canvas.getByRole('img', { name: 'Diagram preview for Select diagram nodes' });
  const download = async () => {
    const [file] = await Promise.all([page.waitForEvent('download'), live.getByRole('button', { name: 'Download v3 project' }).click()]);
    const path = await file.path();
    if (!path) throw new Error('Missing canvas project.');
    return JSON.parse(await readFile(path, 'utf8'));
  };
  const before = await download();
  const ids = new Map<string, string>(before.identity.elements.map((element: { id: string; binding: { sourceId: string } }) =>
    [element.binding.sourceId, element.id]));
  const position = (sourceId: string) => image.evaluate(async (img: HTMLImageElement, id) => {
    const images = (window as Window & { canvasFixtureImages: ReadonlyMap<string, Blob> }).canvasFixtureImages;
    const text = await images.get(img.src)?.text();
    if (!text) throw new Error('Missing rendered canvas frame.');
    const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
    const frame = document.importNode(xml.documentElement, true) as unknown as SVGSVGElement;
    frame.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0';
    document.body.append(frame);
    try {
      const node = frame.querySelector(`[data-element-key="${id}"]`);
      if (!node) throw new Error('Missing measured canvas node.');
      const target = node.getBoundingClientRect();
      const view = frame.getBoundingClientRect();
      const box = img.getBoundingClientRect();
      const fit = Math.min(box.width / view.width, box.height / view.height);
      return { x: (box.width - view.width * fit) / 2 + (target.left - view.left + target.width / 2) * fit,
        y: (box.height - view.height * fit) / 2 + (target.top - view.top + target.height / 2) * fit };
    } finally {
      frame.remove();
    }
  }, ids.get(sourceId));
  await expect(image).toBeVisible();
  await image.click({ position: await position('A') });
  const selected = canvas.getByRole('group', { name: 'Selected diagram node' });
  await expect(selected).toContainText('Client selected');
  await expect(canvas.locator('.v3-canvas-selection rect')).toHaveCount(1);
  await image.click({ position: await position('B'), modifiers: ['Shift'] });
  await expect(canvas.getByRole('status')).toHaveText('2 selected');
  await expect(canvas.locator('.v3-canvas-selection rect')).toHaveCount(2);
  expect(await download()).toEqual(before);

  await page.setViewportSize({ width: 390, height: 844 });
  await image.tap({ position: await position('B') });
  await expect(selected).toContainText('Service selected');
  await page.screenshot({ path: info.outputPath('canvas-node-selection-mobile.png') });
  await selected.getByRole('button', { name: 'Rename selected node' }).press('Enter');
  const edit = page.getByRole('dialog', { name: 'Edit flowchart' });
  await expect(edit.getByRole('textbox', { name: 'Node label' })).toHaveValue('Service');
  await edit.getByRole('textbox', { name: 'Node label' }).fill('Gateway');
  await edit.getByRole('button', { name: 'Preview change' }).click();
  await edit.getByRole('button', { name: 'Apply change' }).click();
  await expect(selected).toContainText('Gateway selected');
  const renamed = await download();
  expect(renamed.source).toBe(source.replace('B[Service]', 'B["Gateway"]'));
  expect(renamed.identity).toEqual(before.identity);
  await selected.getByRole('button', { name: 'Connect selected node' }).tap();
  await expect(edit.getByRole('combobox', { name: 'From', exact: true }).locator('option:checked')).toHaveText('Gateway (B)');
  await edit.getByRole('button', { name: 'Cancel' }).tap();
  await live.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await download()).source).toBe(source);
});
