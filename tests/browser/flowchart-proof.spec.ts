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

test('a pending IndexedDB save checkpoints the latest Undo and preserves a stale tab’s local edit', async ({ page, context }) => {
  const { createDocument } = await import('../../src/lib/storage');
  const source = '\uFEFFflowchart LR\r\nA[One]\r\n';
  const project = { ...createDocument(), title: 'Starting heading', source };
  await expect(page.evaluate(input => window.seedProjectEditor(input), project)).resolves.toBe('migrated');
  const original = await page.evaluate(id => window.openProjectEditorFixture(id), project.id);
  const peer = await context.newPage();
  try {
    await peer.goto(fixtureUrl);
    await peer.waitForFunction(() => 'openProjectEditorFixture' in window);
    await peer.evaluate(id => window.openProjectEditorFixture(id), project.id);

    const checkpoint = await page.evaluate(async id => {
      const editor = window.projectEditor;
      const put = IDBObjectStore.prototype.put;
      const writes: number[] = [];
      let holding = true;
      let firstPut!: () => void;
      const pending = new Promise<void>(resolve => { firstPut = resolve; });
      IDBObjectStore.prototype.put = function (value, key) {
        const request = put.call(this, value, key);
        if (this.name !== 'documents' || value.id !== id) return request;
        writes.push(value.document.revision);
        if (writes.length === 1) {
          const holdTransaction = () => {
            if (holding) this.get(id).onsuccess = holdTransaction;
          };
          holdTransaction();
          firstPut();
        }
        return request;
      };
      let flushing: Promise<void> | undefined;
      try {
        await editor.edit('First checkpoint');
        flushing = editor.flush();
        await Promise.race([pending, flushing]);
        if (!writes.length) throw new Error('The first save did not reach IndexedDB.');
        await editor.edit('Retained heading');
        await editor.edit('Undone heading');
        const undone = editor.undo();
        const beforeRelease = editor.saveState();
        holding = false;
        await flushing;
        return { writes, undone, beforeRelease, saved: editor.saveState(), document: editor.snapshot() };
      } finally {
        holding = false;
        await flushing;
        IDBObjectStore.prototype.put = put;
      }
    }, project.id);
    expect(checkpoint).toMatchObject({
      writes: [1, 4], undone: true,
      beforeRelease: { phase: 'saving', savedRevision: 0, workingRevision: 4 },
      saved: { phase: 'saved', savedRevision: 4, workingRevision: 4 },
    });
    expect(checkpoint.document).toEqual({ ...original, title: 'Retained heading', revision: 4, updatedAt: checkpoint.document.updatedAt });

    const competing = await peer.evaluate(async () => {
      const editor = window.projectEditor;
      await editor.edit('Competing edit');
      await editor.flush();
      return { state: editor.saveState(), document: editor.snapshot() };
    });
    expect(competing).toMatchObject({ state: { phase: 'conflict', savedRevision: 0, workingRevision: 1 }, document: { title: 'Competing edit', source } });
    await peer.reload();
    await peer.waitForFunction(() => 'openProjectEditorFixture' in window);
    await expect(peer.evaluate(id => window.openProjectEditorFixture(id), project.id)).resolves.toEqual(checkpoint.document);
  } finally { await peer.close(); }
});

test('guarded v3 Add, Rename and Connect preserve source bytes and UUIDs through Undo and reopen', async ({ page }) => {
  const { createDocument } = await import('../../src/lib/storage');
  const source = '\uFEFFflowchart LR\r\n  %% Preserve this comment\r\n  A["Start"]\r\n';
  const project = { ...createDocument(), source, nodeAccents: { A: '#159' } };
  await expect(page.evaluate(input => window.seedProjectEditor(input), project)).resolves.toBe('migrated');
  const original = await page.evaluate(id => window.openProjectEditorFixture(id), project.id);
  const start = original.identity.elements.find(item => item.binding.sourceId === 'A');
  if (!start) throw new Error('Missing source node.');
  const changes = await page.evaluate(async id => {
    const editor = window.projectEditor;
    const stale = await editor.prepareStructure({ op: 'setNodeLabel', targetId: id, label: 'Discarded' });
    const add = editor.applyStructure(await editor.prepareStructure({ op: 'addNode', label: 'Archive', shape: 'cylinder' }));
    if (add.status !== 'applied' || !add.elementId) throw new Error('Node creation did not apply.');
    const refused = editor.applyStructure(stale);
    const rename = editor.applyStructure(await editor.prepareStructure({ op: 'setNodeLabel', targetId: id, label: 'Receive' }));
    const connected = editor.applyStructure(await editor.prepareStructure({ op: 'addEdge', sourceId: id, targetId: add.elementId, label: 'Done' }));
    const after = editor.snapshot();
    const undone = editor.undo();
    const withoutEdge = editor.snapshot();
    const redone = editor.redo();
    await editor.flush();
    return { add, refused, rename, connected, after, undone, withoutEdge, redone, save: editor.saveState() };
  }, start.id);
  expect(changes.refused.status).toBe('stale');
  expect(changes.rename).toMatchObject({ status: 'applied', elementId: start.id });
  expect(changes.connected.status).toBe('applied');
  expect(changes.after.source).toBe(source.replace('Start', 'Receive') + '  m_n1[("Archive")]\r\n  A m_e1@-->|"Done"| m_n1\r\n');
  expect(changes.after.identity.elements).toEqual([
    start,
    { id: changes.add.elementId, status: 'resolved', elementKind: 'node', binding: { type: 'source-id', sourceId: 'm_n1' } },
    { id: changes.connected.elementId, status: 'resolved', elementKind: 'edge', binding: { type: 'edge-id', sourceId: 'm_e1' } },
  ]);
  expect(changes.after.design).toEqual(original.design);
  expect(changes.undone).toBe(true);
  expect(changes.withoutEdge.source).toBe(source.replace('Start', 'Receive') + '  m_n1[("Archive")]\r\n');
  expect(changes.redone).toBe(true);
  expect(changes.save).toMatchObject({ phase: 'saved', savedRevision: 5 });

  await page.reload();
  await page.waitForFunction(() => 'openProjectEditorFixture' in window);
  const reopened = await page.evaluate(id => window.openProjectEditorFixture(id), project.id);
  expect(reopened).toEqual({ ...changes.after, revision: 5, updatedAt: reopened.updatedAt });
});

test('measured v3 SVG, UUID targets, endpoints, group membership and styles pair with the same revision', async ({ page }) => {
  const { createDocument } = await import('../../src/lib/storage');
  const project = {
    ...createDocument(), nodeAccents: { A: '#159' },
    source: 'flowchart LR\n  subgraph G\n  A[One]\n  B[Two]\n  end\n  A direct@-->|Go| B',
  };
  await expect(page.evaluate(input => window.seedProjectEditor(input), project)).resolves.toBe('migrated');
  const original = await page.evaluate(id => window.openProjectEditorFixture(id), project.id);
  const ids = Object.fromEntries(original.identity.elements.map(item => [item.binding.sourceId, item.id]));
  const rendered = await page.evaluate(() => window.renderProjectFixture());
  expect(rendered.layouts).toBe(1);
  expect(rendered.targetTable).toMatchObject({ schema: 'meridian-targets/v1', baseToken: { projectId: project.id, revision: 0 } });
  expect(rendered.targetTable?.renderFingerprint).toMatch(/^[a-f0-9]{64}$/);
  const targets = rendered.targetTable?.targets ?? [];
  expect(targets).toHaveLength(4);
  expect(targets.find(item => item.id === ids.A)).toMatchObject({ elementKind: 'node', parentId: ids.G });
  expect(targets.find(item => item.id === ids.G)).toMatchObject({ elementKind: 'group', members: expect.arrayContaining([ids.A, ids.B]) });
  expect(targets.find(item => item.id === ids.direct)).toMatchObject({ elementKind: 'edge', sourceId: ids.A, targetId: ids.B, direction: 'forward' });
  expect(targets.every(item => Object.values(item.bounds).every(Number.isFinite))).toBe(true);
  expect(rendered.elements?.find(item => item.key === ids.A)?.appearance?.fill).toBe('#115599');
  expect(rendered.targets).toEqual(expect.arrayContaining(targets.map(item => ({ id: item.id, kind: item.elementKind }))));
  expect(rendered.owners).toContain(ids.direct);
  const next = await page.evaluate(async () => {
    await window.projectEditor.edit('A different heading');
    return window.renderProjectFixture();
  });
  expect(next.layouts).toBe(0);
  expect(next.targetTable).toMatchObject({ baseToken: { revision: 1 }, renderFingerprint: rendered.targetTable?.renderFingerprint, targets });
  expect(next.targetTable?.baseToken.stateDigest).not.toBe(rendered.targetTable?.baseToken.stateDigest);
});

test('studio and network-blocked v3 presentations use the same targets, camera and directional flow', async ({ page, browser }) => {
  const { createDocument } = await import('../../src/lib/storage');
  const { createScene } = await import('../../src/lib/storyboard');
  const first = {
    ...createScene(), title: 'Endpoint only', visible: ['node:A', 'edge:id:go'], flow: ['edge:id:go'],
    camera: { mode: 'elements' as const, keys: ['node:A'], padding: 24 },
  };
  const second = { ...createScene(), title: 'Both endpoints', visible: ['node:A', 'node:B', 'edge:id:go'], flow: ['edge:id:go'] };
  const project = {
    ...createDocument(), source: 'flowchart LR\n  subgraph G\n  A[One]\n  B[Two]\n  C[Hidden]\n  end\n  A go@<--> B',
    storyboard: { version: 1 as const, loop: false, scenes: [first, second] },
  };
  await expect(page.evaluate(input => window.seedProjectEditor(input), project)).resolves.toBe('migrated');
  const original = await page.evaluate(id => window.openProjectEditorFixture(id), project.id);
  const ids = Object.fromEntries(original.identity.elements.map(item => [item.binding.sourceId, item.id]));
  const expected = await page.evaluate(() => window.compareProjectPresentation());
  expect(expected.staleRejected).toBe(true);
  expect(new Set(expected.first.visible)).toEqual(new Set([ids.A, ids.G, ids.go]));
  expect(expected.first.flows).toEqual([]);
  expect(new Set(expected.second.visible)).toEqual(new Set([ids.A, ids.B, ids.G, ids.go]));
  expect(expected.second.flows).toEqual([ids.go, ids.go]);
  expect(expected.second.camera).not.toBe(expected.first.camera);

  const offline = await browser.newContext({ offline: true, reducedMotion: 'no-preference' });
  try {
    const exported = await offline.newPage();
    const network: string[] = [];
    exported.on('request', request => network.push(request.url()));
    await exported.setContent(expected.html);
    const inspect = () => exported.locator('main > svg').evaluate(root => ({
      scene: root.getAttribute('data-story-scene'),
      visible: Array.from(root.querySelectorAll('[data-element-key][aria-hidden="false"]'), element => element.getAttribute('data-element-key')),
      flows: Array.from(root.querySelectorAll<SVGElement>('[data-story-flow]'))
        .filter(element => element.style.display !== 'none').map(element => element.getAttribute('data-story-flow')),
      camera: root.getAttribute('viewBox'),
    }));
    await expect.poll(inspect).toEqual(expected.first);
    await exported.getByRole('button', { name: 'Next scene' }).click();
    await expect.poll(inspect).toEqual(expected.second);
    expect(network).toEqual([]);
  } finally {
    await offline.close();
  }
});
