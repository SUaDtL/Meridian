import { describe, expect, it } from 'vitest';
import { edgeIdentities, type FlowModel } from '../design';
import { createDocument, parseProject, serializeProject } from '../storage';
import { createScene } from '../storyboard';
import { migrateLegacyProject, type MigrationOutcome } from './migrate-legacy-project';

function fixture() {
  const source = '\uFEFFflowchart LR\r\nsubgraph G\r\nA[Start]\r\nB[Finish]\r\nend\r\nA link@--> B\r\nA --> B\r\nA --> B\r\n';
  const model: FlowModel = {
    vertices: new Map([['A', { id: 'A' }], ['B', { id: 'B' }]]),
    groups: [{ id: 'G', nodes: ['A', 'B'] }],
    edges: [
      { id: 'link', isUserDefinedId: true, start: 'A', end: 'B' },
      { start: 'A', end: 'B', text: '' }, { start: 'A', end: 'B', text: '' },
    ],
  };
  const [, first, second] = edgeIdentities(model.edges);
  const document = parseProject(serializeProject({
    ...createDocument(), id: 'old-project', source,
    design: { preset: 'custom', elements: { 'node:A': { fill: '#187abc', shadow: true }, [first]: { stroke: '#123456' } } },
    nodeAccents: { A: '#ABC', B: '#129', Missing: '#def' },
    storyboard: {
      version: 1, loop: false,
      scenes: [{
        ...createScene(), visible: ['node:A', 'group:G', 'node:Missing'],
        highlight: [first, 'node:B'], flow: [second, 'edge:id:link'],
        camera: { mode: 'elements', keys: ['group:G', 'node:Missing'], padding: 30 },
      }, { ...createScene(1), visible: null }],
    },
  }));
  return { source, model, document, first, second };
}

function migrated(outcome: MigrationOutcome) {
  if (outcome.status !== 'migrated') throw new Error(`Expected migrated document, got ${outcome.reason}`);
  return outcome.document;
}

describe('v2 identity migration preflight', () => {
  it('remaps uniquely bound annotations and preserves ambiguous or missing references at their original slots', async () => {
    const { source, model, document, first, second } = fixture();
    const original = serializeProject(document);
    const result = migrated(await migrateLegacyProject(document, { status: 'verified', model }));
    expect(serializeProject(document)).toBe(original);
    expect(result.source).toBe(source);
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).not.toHaveProperty('nodeAccents');
    const ids = Object.fromEntries(result.identity.elements.map(record => [record.binding.sourceId, record.id]));
    expect(result.design.elements).toEqual({
      [ids.A]: { fill: '#187abc', shadow: true },
      [ids.B]: { fill: '#112299' },
    });
    expect(result.storyboard.scenes[0]).toMatchObject({
      visible: [ids.A, ids.G], highlight: [ids.B], flow: [ids.link],
      camera: { mode: 'elements', keys: [ids.G], padding: 30 },
    });
    expect(result.storyboard.scenes[1].visible).toBeNull();
    const sceneId = document.storyboard!.scenes[0].id;
    expect(result.identity.orphans).toEqual([
      expect.objectContaining({ legacyKey: first, reason: 'ambiguous', retained: { style: { stroke: '#123456' },
        sceneReferences: [{ sceneId, field: 'highlight', index: 0 }] } }),
      expect.objectContaining({ legacyKey: 'node:Missing', reason: 'missing', retained: { style: { fill: '#ddeeff' },
        sceneReferences: [{ sceneId, field: 'visible', index: 2 }, { sceneId, field: 'camera', index: 1 }] } }),
      expect.objectContaining({ legacyKey: second, reason: 'ambiguous', retained: {
        sceneReferences: [{ sceneId, field: 'flow', index: 0 }] } }),
    ]);
  });

  it('uses old higher ordinals as ambiguity evidence even if only one matching edge remains', async () => {
    const { model, document, first, second } = fixture();
    model.edges.pop();
    const result = migrated(await migrateLegacyProject(document, { status: 'verified', model }));
    expect(result.identity.orphans).toEqual(expect.arrayContaining([
      expect.objectContaining({ legacyKey: first, reason: 'ambiguous' }),
      expect.objectContaining({ legacyKey: second, reason: 'ambiguous' }),
    ]));
    expect(result.storyboard.scenes[0].highlight).toHaveLength(1);
  });

  it('preserves invalid source as a recovery project and keeps unsupported annotations intact', async () => {
    const { document } = fixture();
    const broken = { ...document, source: 'flowchart LR\uD800' };
    const recovered = await migrateLegacyProject(broken, { status: 'invalid' });
    expect(recovered).toEqual({ status: 'recovery', reason: 'source', document: broken });
    expect(recovered.document).toBe(broken);
    const unsupported = migrated(await migrateLegacyProject(document, { status: 'unsupported' }));
    expect(unsupported.identity.elements).toEqual([]);
    expect(unsupported.identity.orphans.every(orphan => orphan.reason === 'unsupported')).toBe(true);
    expect(unsupported.source).toBe(document.source);
  });

  it('splits retained scene slots at the contract limit without losing their positions', async () => {
    const { document } = fixture();
    document.storyboard = {
      version: 1, loop: true,
      scenes: Array.from({ length: 50 }, (_, index) => ({
        ...createScene(index), visible: ['node:Missing'], highlight: ['node:Missing'],
        camera: { mode: 'elements', keys: ['node:Missing'], padding: 20 },
      })),
    };
    const result = migrated(await migrateLegacyProject(document, { status: 'unsupported' }));
    const slots = result.identity.orphans.filter(orphan => orphan.legacyKey === 'node:Missing');
    expect(slots.map(orphan => orphan.retained.sceneReferences?.length)).toEqual([100, 50]);
    expect(slots[1].retained.sceneReferences?.at(-1)).toEqual({
      sceneId: document.storyboard.scenes[49].id, field: 'camera', index: 0,
    });
    expect(result.storyboard.loop).toBe(true);
  });

  it('quarantines excess orphans and retains the complete v2 result', async () => {
    const { document } = fixture();
    document.nodeAccents = Object.fromEntries(Array.from({ length: 501 }, (_, index) => [`Absent${index}`, '#123']));
    const rejected = await migrateLegacyProject(document, { status: 'unsupported' });
    expect(rejected).toMatchObject({ status: 'recovery', reason: 'annotations' });
    expect(rejected.document).toBe(document);
    expect(Object.keys(document.nodeAccents)).toHaveLength(501);
  });
});
