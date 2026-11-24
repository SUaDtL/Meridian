import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test, type Page, type Locator } from '@playwright/test';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import JSZip from 'jszip';
import { createDocument, STORAGE_KEY } from '../../src/lib/storage';
import { createScene } from '../../src/lib/storyboard';

async function downloaded(page: Page, control: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), control.click()]);
  expect(await file.failure()).toBeNull();
  return { name: file.suggestedFilename(), bytes: await readFile((await file.path())!) };
}

for (const mode of ['studio', 'offline guided'] as const) {
  test(`${mode} exports only visible audience artwork with one page per selected scene`, async ({ page, context }, info) => {
    const secret = 'Private rehearsal instruction';
    let keys = ['node:A', 'node:B'];
    const scenes = () => keys.map((key, index) => ({ ...createScene(index), title: ['Client view', 'Service view'][index],
      visible: [key], highlight: [key], notes: secret, camera: { mode: 'elements', keys: [key], padding: 16 } }));
    if (mode === 'studio') {
      const doc = { ...createDocument(), title: 'Briefing', source: 'flowchart LR\n A[Client] --> B[Service]',
        storyboard: { version: 1, scenes: scenes(), loop: false } };
      await page.addInitScript(({doc, key}) => localStorage.setItem(key, JSON.stringify({ version: 2, activeId: doc.id, documents: [doc] })), {doc, key: STORAGE_KEY});
      await page.goto('/');
      await page.getByRole('button', { name: 'Continue project: Briefing' }).click();
    } else {
      await context.setOffline(true);
      await page.goto(pathToFileURL(resolve('standalone/Meridian.html')).href);
      const doc = JSON.parse(await readFile('src/lib/authoring/fixtures/example-project.json', 'utf8'));
      keys = doc.identity.elements.filter((item: {elementKind: string}) => item.elementKind === 'node').map((item: {id:string}) => item.id);
      doc.storyboard.scenes = scenes();
      await page.getByLabel('Import project file').setInputFiles({ name: 'briefing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
    }
    await expect(page.getByTestId('rendered-diagram').locator('[data-element-kind="node"]').first()).toBeVisible();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Take your diagram with you.' });
    await dialog.getByRole('button', { name: /^PDF Widescreen/ }).click();
    await dialog.getByRole('combobox', { name: 'Pages', exact: true }).selectOption('scenes');
    await dialog.getByRole('combobox', { name: 'Preview scene', exact: true }).selectOption('1');
    const pdfFile = await downloaded(page, dialog.getByRole('button', { name: 'Download PDF' }));
    expect(pdfFile.name).toMatch(/\.pdf$/);
    const pdf = await PDFDocument.load(pdfFile.bytes);
    expect(pdf.getPages().map(p => p.getSize())).toEqual([{width:960,height:540},{width:960,height:540}]);
    const images = pdf.context.enumerateIndirectObjects().flatMap(([, object]) =>
      object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image') ? [object.contents] : []);
    expect(images).toHaveLength(2);
    expect(Buffer.compare(images[0], images[1])).not.toBe(0);
    expect(pdfFile.bytes.includes(Buffer.from(secret))).toBe(false);

    await dialog.getByRole('button', { name: /^PowerPoint Widescreen/ }).click();
    const deckFile = await downloaded(page, dialog.getByRole('button', { name: 'Download PPTX' }));
    expect(deckFile.name).toMatch(/\.pptx$/);
    const zip = await JSZip.loadAsync(deckFile.bytes);
    expect(zip.file(/^ppt\/slides\/slide\d+\.xml$/)).toHaveLength(2);
    const media = zip.file(/^ppt\/media\/.*\.png$/);
    expect(media).toHaveLength(2);
    const [first, second] = await Promise.all(media.map(entry => entry.async('nodebuffer')));
    expect(first.readUInt32BE(16)).toBe(1920); expect(first.readUInt32BE(20)).toBe(1080);
    expect(first.equals(second)).toBe(false);
    const allXml = (await Promise.all(zip.file(/\.xml$/).map(entry => entry.async('text')))).join('\n');
    expect(allXml).not.toContain(secret);
    expect(await zip.file('ppt/slides/slide1.xml')!.async('text')).toContain('Client view');
    expect(await zip.file('ppt/slides/slide2.xml')!.async('text')).toContain('Service view');
    await info.attach('audience-deck.pptx', { body: deckFile.bytes, contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    await info.attach('audience-document.pdf', { body: pdfFile.bytes, contentType: 'application/pdf' });
    await dialog.getByRole('combobox', { name: 'Pages', exact: true }).selectOption('diagram');
    const single = await downloaded(page, dialog.getByRole('button', { name: 'Download PPTX' }));
    expect((await JSZip.loadAsync(single.bytes)).file(/^ppt\/slides\/slide\d+\.xml$/)).toHaveLength(1);
  });
}

test('an imported chart downloads as a one-page PDF and a PowerPoint slide', async ({ page }) => {
  await page.goto('/');
  const doc = await readFile('src/lib/authoring/fixtures/example-chart.json');
  await page.getByLabel('Import project file').setInputFiles({ name: 'chart.json', mimeType: 'application/json', buffer: doc });
  const chart = page.getByRole('dialog', { name: 'Chart projects' });
  const pdf = await downloaded(page, chart.getByRole('button', { name: 'Download PDF' }));
  expect((await PDFDocument.load(pdf.bytes)).getPageCount()).toBe(1);
  const deck = await downloaded(page, chart.getByRole('button', { name: 'Download PowerPoint' }));
  expect((await JSZip.loadAsync(deck.bytes)).file(/^ppt\/slides\/slide\d+\.xml$/)).toHaveLength(1);
});
