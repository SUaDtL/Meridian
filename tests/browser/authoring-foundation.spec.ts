import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { verifyNodeLabels, writeFlowchart, type FlowchartInput } from '../../src/lib/authoring/flowchart-source';
import { applySourcePatches, planEdgeRemoval, planNodeLabel } from '../../src/lib/authoring/source-patches';
import { DRAWING, ready } from './helpers';

async function importSource(page: Page, source: string) {
  await page.goto('/');
  await page.getByLabel('Import project file').setInputFiles({
    name: 'foundation.mmd',
    mimeType: 'text/plain',
    buffer: Buffer.from(source),
  });
  await ready(page);
}

test('canonical topology renders with explicit identities and round-trips as project JSON', async ({ page }) => {
  const input: FlowchartInput = {
    direction: 'TB',
    nodes: [
      { key: 'approved', label: 'Review' },
      { key: 'decision', label: '東京 🔒', shape: 'diamond' },
      { key: 'rejected', label: 'Review' },
    ],
    edges: [{ from: 'decision', to: 'approved', label: 'Yes' }, { from: 'decision', to: 'rejected' }],
  };
  const graph = writeFlowchart(input);
  await importSource(page, graph.source);
  const diagram = page.locator(DRAWING);
  await expect(diagram.locator('[data-element-kind=node]')).toHaveCount(3);
  await expect(diagram.locator('[data-element-kind=edge]')).toHaveCount(2);
  await expect(diagram.locator('[data-element-key="edge:id:m_e1"]')).toHaveCount(1);
  await expect(diagram.locator('[data-element-key="edge:id:m_e2"]')).toHaveCount(1);
  await expect(diagram.locator('[data-element-owner="edge:id:m_e1"].edgeLabel')).toHaveText('Yes');
  await expect(diagram.locator('[data-node-key="m_n2"]')).toContainText('東京 🔒');
  verifyNodeLabels(input, graph, await renderedNodeLabels(page));
  await test.info().attach('canonical-flowchart-desktop', { body: await page.screenshot(), contentType: 'image/png' });

  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Project/ }).click();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download project' }).click();
  const saved = await (await download).path();
  if (!saved) throw new Error('No downloaded project path.');
  const project = await readFile(saved);
  expect(JSON.parse(project.toString('utf8')).source).toBe(graph.source);
  await dialog.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByLabel('Import project file').setInputFiles({
    name: 'foundation.meridian.json',
    mimeType: 'application/json',
    buffer: project,
  });
  await ready(page);
  await expect(diagram.locator('[data-element-kind=edge]')).toHaveCount(2);
});

test('label replacement and indexed edge removal survive the pinned renderer', async ({ page }) => {
  const source = [
    'flowchart LR',
    '  %% leave this intact',
    '  A["Start"]; B["Finish"]',
    '  A first@--> B',
    '  A second@-->|"Keep"| B',
    '  linkStyle 0 stroke:#ff0000',
    '  linkStyle 1 stroke:#00bb00,stroke-width:4px',
  ].join('\n');
  const renamed = applySourcePatches(source, planNodeLabel(source, 'A', 'Next step'));
  const candidate = applySourcePatches(renamed, planEdgeRemoval(renamed, 'first'));
  await importSource(page, candidate);
  const diagram = page.locator(DRAWING);
  await expect(diagram.locator('[data-node-key=A]')).toContainText('Next step');
  await expect(diagram.locator('[data-node-key=B]')).toContainText('Finish');
  await expect(diagram.locator('[data-element-kind=edge]')).toHaveCount(1);
  await expect(diagram.locator('[data-element-key="edge:id:second"]')).toHaveAttribute('style', /stroke:\s*(?:#00bb00|rgb\(0, 187, 0\))/i);
  await expect(diagram.locator('[data-element-owner="edge:id:second"].edgeLabel')).toHaveText('Keep');
});

async function renderedNodeLabels(page: Page): Promise<Map<string, string>> {
  const entries = await page.locator(DRAWING).locator('[data-node-key]').evaluateAll(nodes =>
    nodes.map(node => [node.getAttribute('data-node-key')!, node.textContent ?? ''] as const),
  );
  return new Map(entries);
}

test('the label proof declines punctuation that the pinned renderer displays as entities', async ({ page }) => {
  const { default: { fixtures } } = await import('../../src/lib/authoring/fixtures/label-encoder-fixtures.json', { with: { type: 'json' } });
  const input: FlowchartInput = { direction: 'LR', nodes: fixtures.map(({ input }, index) => ({ key: String(index), label: input })), edges: [] };
  const graph = writeFlowchart(input);
  await importSource(page, graph.source);
  const labels = await renderedNodeLabels(page);
  expect([...labels.values()]).toEqual([
    'Approve request', 'A&#34;B', 'x&#91;y&#93;', 'A&#124;B', '&#35;quot&#59;',
    'end', 'API &#60; v2', '東京 🔒',
  ]);
  expect(() => verifyNodeLabels(input, graph, labels)).toThrow("could not display node 2's label exactly");
});

test('source keyboard Undo and Redo follow project history across heading edits', async ({ page }) => {
  await importSource(page, 'flowchart LR\nA[Original]');
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText('flowchart LR\nA[Changed]');
  await expect(page.locator(DRAWING).locator('[data-node-key=A]')).toContainText('Changed');
  await page.getByRole('button', { name: 'Edit heading', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill('New heading');
  await dialog.getByRole('button', { name: 'Apply heading', exact: true }).click();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(page.locator('.heading-button')).toHaveText('foundation');
  await expect(editor).toContainText('A[Changed]');
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(editor).toContainText('A[Original]');
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(editor).toContainText('A[Changed]');
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(page.locator('.heading-button')).toHaveText('New heading');
});

test('source history remains available from touch controls', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await importSource(page, 'flowchart LR\nA[Original]');
    await page.getByRole('button', { name: 'Source', exact: true }).tap();
    const editor = page.locator('.cm-content');
    await editor.tap();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('flowchart LR\nA[Changed]');
    await expect(editor).toContainText('A[Changed]');
    await page.getByRole('button', { name: 'Undo', exact: true }).tap();
    await expect(editor).toContainText('A[Original]');
    await page.getByRole('button', { name: 'Redo', exact: true }).tap();
    await expect(editor).toContainText('A[Changed]');
    await test.info().attach('source-history-mobile', { body: await page.screenshot(), contentType: 'image/png' });
  } finally {
    await context.close();
  }
});
