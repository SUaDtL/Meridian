import { describe, expect, it } from 'vitest';
import { reconcileIdentities, type IdentityRecord, type SourceIdentity } from './identities';

const node = (sourceId: string): SourceIdentity => ({ elementKind: 'node', binding: { type: 'source-id', sourceId } });
const edge = (occurrence: number): SourceIdentity => ({
  elementKind: 'edge',
  binding: { type: 'legacy-edge', sourceId: 'A', targetId: 'B', labelHash: 'ab'.repeat(32), occurrence, fingerprint: 'cd'.repeat(32) },
});
const references = (...ids: string[]) => new Set(ids);

describe('source identity lifetime', () => {
  it('retains the same stable identities when a valid projection repeats or changes order', () => {
    const previous = reconcileIdentities([], [node('A'), node('B')], references(), 0);
    const next = reconcileIdentities(previous, [node('B'), node('A')], references(), 0);
    expect(next).toEqual(previous);
    expect(next[0]).toBe(previous[0]);
  });

  it('preserves identities during incomplete typing, retires referenced deletions, and never reuses an old ID', () => {
    const previous = reconcileIdentities([], [node('A'), node('B')], references(), 0);
    const referenced = references(previous[0].id);
    expect(reconcileIdentities(previous, null, referenced, 0)).toBe(previous);
    const deleted = reconcileIdentities(previous, [], referenced, 0);
    expect(deleted).toEqual([{ ...previous[0], status: 'retired' }]);
    const reused = reconcileIdentities(deleted, [node('A')], referenced, 0);
    expect(reused[0]).toBe(deleted[0]);
    expect(reused[1].id).not.toBe(previous[0].id);
    expect(reused[1].status).toBe('resolved');
    expect(previous[0].status).toBe('resolved');
  });

  it('refuses to transfer annotated implicit connectors across ambiguous parallel edges', () => {
    const previous = reconcileIdentities([], [edge(0)], references(), 0);
    const referenced = references(previous[0].id);
    const parallel = reconcileIdentities(previous, [edge(0), edge(1)], referenced, 0);
    expect(parallel).toEqual([{ ...previous[0], status: 'ambiguous' }]);
    const unique = reconcileIdentities(parallel, [edge(0)], referenced, 0);
    expect(unique[0].status).toBe('ambiguous');
    expect(unique[1].id).not.toBe(previous[0].id);
    expect(unique[1].status).toBe('resolved');
  });

  it('rejects duplicate bindings and identifier reuse', () => {
    const previous = reconcileIdentities([], [node('A')], references(), 0);
    expect(() => reconcileIdentities(previous, [node('A'), node('A')], references(), 0)).toThrow('duplicate binding');
    expect(() => reconcileIdentities(previous, [node('B')], references(), 0, () => previous[0].id)).toThrow('unique element ID');
  });

  it('counts retained identities and orphan annotations together before accepting a deletion', () => {
    const previous = reconcileIdentities([], [node('A')], references(), 0);
    const referenced = references(previous[0].id);
    expect(() => reconcileIdentities(previous, [], referenced, 500)).toThrow('retained annotation limits');
    expect(previous[0].status).toBe('resolved');
    const retired: IdentityRecord = { ...previous[0], status: 'retired' };
    expect(reconcileIdentities([retired], [], references(), 499)).toEqual([]);
  });
});

it('observes explicit kinds and existing migration keys without taking identities from SVG IDs', async () => {
  const { observeFlowchartIdentities } = await import('./identity-observation');
  const graph = {
    vertices: new Map([['A', { id: 'A' }], ['B', { id: 'B' }], ['G', { id: 'G' }]]),
    groups: [{ id: 'G', nodes: ['B'] }],
    edges: [
      { id: 'route', isUserDefinedId: true, start: 'A', end: 'G' },
      { id: 'L_A_B_0', start: 'A', end: 'B', text: 'Parallel' },
      { id: 'L_A_B_1', start: 'A', end: 'B', text: 'Parallel' },
    ],
  };
  const observed = await observeFlowchartIdentities(graph);
  expect(observed.map(record => record.legacyKey)).toEqual([
    'node:A', 'node:B', 'group:G', 'edge:id:route',
    expect.stringMatching(/^edge:A:B:[a-z0-9]+:0$/), expect.stringMatching(/^edge:A:B:[a-z0-9]+:1$/),
  ]);
  expect(observed[3]).toMatchObject({ elementKind: 'edge', binding: { type: 'edge-id', sourceId: 'route' } });
  expect(observed[4].binding).toMatchObject({ occurrence: 0, labelHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(observed[5].binding).toMatchObject({ occurrence: 1 });
  const registry = reconcileIdentities([], observed, references(), 0);
  expect(registry.map(record => record.elementKind)).toEqual(['node', 'node', 'group', 'edge']);
  for (const record of registry) expect(record).not.toHaveProperty('legacyKey');
});
