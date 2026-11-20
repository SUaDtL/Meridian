import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import type { SourceIntent } from '../../src/lib/authoring/flowchart-proof';

let fixtureServer: ViteDevServer;
let fixtureUrl: string;

test.beforeAll(async () => {
  fixtureServer = await createServer({
    configFile: false,
    optimizeDeps: { entries: ['tests/fixtures/flowchart-proof.html'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  });
  await fixtureServer.listen();
  const address = fixtureServer.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('The flowchart fixture server has no TCP address.');
  fixtureUrl = `http://127.0.0.1:${address.port}/tests/fixtures/flowchart-proof.html`;
});

test.afterAll(async () => { await fixtureServer?.close(); });

async function prove(page: Page, source: string, intent: SourceIntent) {
  return page.evaluate(({ text, operation }) => {
    const run = (window as Window & { proveFlowchartFixture: (text: string, operation: SourceIntent) => Promise<{
      source: string; sourceId: string; original: string;
    }> }).proveFlowchartFixture;
    return run(text, operation);
  }, { text: source, operation: intent });
}

const original = [
  '\ufeffflowchart TD',
  '  %% preserve comments and line endings',
  '  A["Start"]; B(["Finish"])',
  '  A first@--> B',
  '  A second@-->|"Keep"| B',
  '  linkStyle 0 stroke:#ff0000',
  '  linkStyle 0,1 stroke-width:4px',
  '  linkStyle 1 interpolate basis',
  '  linkStyle default stroke:#005500',
  '',
].join('\r\n');

test.beforeEach(async ({ page }) => {
  await page.goto(fixtureUrl);
  await page.waitForFunction(() => 'proveFlowchartFixture' in window);
});

test('the pinned renderer proves add, rename and connect while retaining existing edge semantics', async ({ page }) => {
  const rename = await prove(page, original, { op: 'setNodeLabel', sourceId: 'A', label: '東京 🔒' });
  expect(rename.original).toBe(original);
  expect(rename.source).toBe(original.replace('"Start"', '"東京 🔒"'));
  const add = await prove(page, rename.source, { op: 'addNode', label: 'Archive', shape: 'cylinder' });
  expect(add.source).toBe(rename.source + '  m_n1[("Archive")]\r\n');
  const connect = await prove(page, add.source, { op: 'addEdge', from: 'B', to: add.sourceId, label: 'Done' });
  expect(connect.source).toBe(add.source + '  B m_e1@-->|"Done"| m_n1\r\n');
});

test('the pinned renderer proves indexed parallel-edge removal and refuses inexact or unsupported edits', async ({ page }) => {
  const removed = await prove(page, original, { op: 'removeEdge', sourceId: 'first' });
  expect(removed.source).toBe(original.replace('A first@--> B', '').replace('linkStyle 0 stroke:#ff0000', '')
    .replace('linkStyle 0,1 stroke-width:4px', 'linkStyle 0 stroke-width:4px')
    .replace('linkStyle 1 interpolate basis', 'linkStyle 0 interpolate basis'));
  await expect(prove(page, original, { op: 'setNodeLabel', sourceId: 'A', label: 'A|B' })).rejects.toThrow('could not display that label exactly');
  await expect(prove(page, original + '  subgraph Group\r\n  end\r\n', { op: 'removeEdge', sourceId: 'first' })).rejects.toThrow('outside the supported editing subset');
});
