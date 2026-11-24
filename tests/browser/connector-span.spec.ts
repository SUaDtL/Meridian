import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocument } from '../../src/lib/storage';

for (const kind of ['scratch', 'guided'] as const) {
  test(`${kind} preserves minimum connector span, source and identity across a portable round trip`, async ({ page }) => {
    const doc = kind === 'guided' ? JSON.parse(await readFile('src/lib/authoring/fixtures/example-project.json', 'utf8'))
      : { ...createDocument(), title: 'Rank span', source: 'flowchart LR\n  A["First --> label"] first@-->|yes| B[Next]' };
    doc.settings.layout = 'dagre';
    await page.goto('/');
    const upload = page.getByLabel('Import project file');
    const open = (bytes: Buffer) => upload.setInputFiles({ name: 'ranks.meridian.json', mimeType: 'application/json', buffer: bytes });
    await open(Buffer.from(JSON.stringify(doc)));
    const diagram = page.getByTestId('rendered-diagram');
    const edge = diagram.locator('path[data-element-kind="edge"]').first();
    await expect(edge).toBeAttached();
    const key = (await edge.getAttribute('data-element-key'))!;
    const width = () => diagram.locator('svg[data-meridian="diagram"]').evaluate(node => (node as SVGSVGElement).viewBox.baseVal.width);
    const baseline = await width();
    const inspect = page.getByLabel('Inspect an element');
    await inspect.selectOption(key);
    const span = page.getByRole('combobox', { name: 'Minimum connector span' });
    await expect(span).toBeEnabled();
    await span.selectOption('4');
    await expect.poll(width).toBeGreaterThan(baseline + 30);
    const expanded = await width();
    await page.getByRole('button', {name:'Export',exact:true}).click();
    const dialog = page.getByRole('dialog', { name: 'Take your diagram with you.' });
    await dialog.getByRole('button', { name: /^Project Editable/ }).click();
    const [file] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', {name:'Download project',exact:true}).click()]);
    const bytes = await readFile((await file.path())!);
    const saved = JSON.parse(bytes.toString());
    expect(saved.source).toBe(doc.source);
    expect(saved.design.elements[key].rankSpan).toBe(4);
    if (kind === 'guided') expect(saved.identity).toEqual(doc.identity);
    await dialog.getByRole('button', {name:'Close dialog'}).click();
    await span.selectOption('');
    await expect.poll(width).toBeCloseTo(baseline, 1);
    await open(bytes);
    await expect.poll(width).toBeCloseTo(expanded, 1);
    await inspect.selectOption(key);
    await expect(span).toHaveValue('4');
  });
}
