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

test('migrates source and scene targets using the actual pinned flowchart model', async ({ page }) => {
  const { createDocument } = await import('../../src/lib/storage');
  const { createScene } = await import('../../src/lib/storyboard');
  const source = '\uFEFFflowchart LR\r\n  subgraph G\r\n    A[Start]\r\n    B[Finish]\r\n  end\r\n  A direct@--> B\r\n';
  const document = {
    ...createDocument(), source, nodeAccents: { A: '#159' },
    storyboard: {
      version: 1 as const, loop: false,
      scenes: [{ ...createScene(), visible: ['group:G'], highlight: ['node:A'], flow: ['edge:id:direct'] }],
    },
  };
  const result = await page.evaluate(input => window.migrateLegacyFixture(input), document);
  expect(result.status).toBe('migrated');
  if (result.status !== 'migrated') throw new Error(result.reason);
  expect(result.document.source).toBe(source);
  const ids = Object.fromEntries(result.document.identity.elements.map(record => [record.binding.sourceId, record.id]));
  expect(result.document.storyboard.scenes[0]).toMatchObject({
    visible: [ids.G], highlight: [ids.A], flow: [ids.direct],
  });
  expect(result.document.design.elements[ids.A]).toEqual({ fill: '#115599' });
  expect(result.document.identity.orphans).toEqual([]);
  await expect(page.evaluate(input => window.migrateLegacyFixture(input), { ...document, source: 'flowchart LR\nA[' }))
    .resolves.toMatchObject({ status: 'recovery', reason: 'source' });
});

test('two tabs writing the same saved anchor produce one committed IndexedDB project', async ({ page }) => {
  const { createDocument } = await import('../../src/lib/storage');
  const document = { ...createDocument(), source: 'flowchart LR\nA[One]\nB[Two]\nA edge1@--> B' };
  const result = await page.evaluate(input => window.checkConcurrentWorkspaceSave(input), document);
  expect(result.winners).toBe(1);
  expect(result.rejected).toEqual(['StorageConflict']);
  expect(['First tab', 'Second tab']).toContain(result.savedTitle);
  expect(result.staleSameDigest).toBe('StorageConflict');
});

test('aborting at every IndexedDB migration write keeps the legacy workspace intact', async ({ page }) => {
  const result = await page.evaluate(() => window.checkInterruptedMigration());
  expect(result.interrupted).toEqual([1, 2, 3, 4].map(reached =>
    ({ reached, projects: 0, hasArchive: false, hasActive: false })));
  expect(result.changedBeforeCommit).toBe(true);
  expect(result.backedUpExactly).toBe(true);
  expect(result.bothLegacyKeysPreserved).toBe(true);
  expect(result.statuses).toEqual(['migrated', 'already-migrated']);
  expect(result.migratedCount).toBe(2);
  expect(result.manifest).toMatchObject({
    counts: { total: 3, migrated: 2, quarantined: 1 }, activeId: result.secondId,
    quarantined: [{ index: 2, reason: 'source' }],
  });
  expect(result.activation).toMatchObject({ activeId: result.secondId, sourceChecksum: result.manifest.sourceChecksum });
  expect(result.changedLater).toBe('legacy-changed');
});

test('a migrated v3 project applies, undoes and reopens a guarded edit across tabs', async ({ page, context }) => {
  const { createDocument } = await import('../../src/lib/storage');
  const project = { ...createDocument(), title: 'Original', source: '\uFEFFflowchart LR\r\nA[One]\r\n' };
  await expect(page.evaluate(input => window.seedProjectEditor(input), project)).resolves.toBe('migrated');
  const original = await page.evaluate(id => window.openProjectEditorFixture(id), project.id);
  const peer = await context.newPage();
  await peer.goto(fixtureUrl);
  await peer.waitForFunction(() => 'openProjectEditorFixture' in window);
  await peer.evaluate(id => window.openProjectEditorFixture(id), project.id);

  const edited = await page.evaluate(async () => {
    const editor = window.projectEditor;
    const applied = await editor.edit('Renamed');
    const beforeSave = editor.saveState();
    await editor.flush();
    const afterSave = editor.saveState();
    const stale = await editor.applyStale('Do not apply');
    await editor.flush();
    return { applied, beforeSave, afterSave, stale, undo: editor.saveState() };
  });
  expect(edited).toMatchObject({
    applied: 'applied',
    beforeSave: { phase: 'scheduled', savedRevision: 0, workingRevision: 1 },
    afterSave: { phase: 'saved', savedRevision: 1 },
    stale: 'stale',
    undo: { phase: 'saved', savedRevision: 2 },
  });
  const conflict = await peer.evaluate(async () => {
    const editor = window.projectEditor;
    await editor.edit('Another tab');
    await editor.flush();
    return { ...editor.saveState(), retained: editor.snapshot().title };
  });
  expect(conflict).toMatchObject({ phase: 'conflict', savedRevision: 0, workingRevision: 1, retained: 'Another tab' });

  await page.reload();
  await page.waitForFunction(() => 'openProjectEditorFixture' in window);
  const reopened = await page.evaluate(id => window.openProjectEditorFixture(id), project.id);
  expect(reopened).toEqual({ ...original, revision: 2, updatedAt: reopened.updatedAt });
});
