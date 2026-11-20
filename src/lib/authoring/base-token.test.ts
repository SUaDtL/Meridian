import { describe, expect, it } from 'vitest';
import { canonicalDigest, canonicalJson, projectBaseToken, sameBaseToken } from './base-token';
import sample from './fixtures/example-project.json';
import rawVectors from './fixtures/hash-vectors.json?raw';

// The exact fixture intentionally contains escaped, unpaired UTF-16 surrogates.
const vectors = JSON.parse(rawVectors) as typeof import('./fixtures/hash-vectors.json');

const project = { ...sample, documentKind: 'mermaid' as const };

describe('canonical state identity', () => {
  it.each(vectors.sourceExamples)('hashes $canonical exactly', async ({ source, canonical, digest }) => {
    expect(canonicalJson(source)).toBe(canonical);
    expect(await canonicalDigest('meridian-source/v1', source)).toBe(digest);
  });

  it('matches the package project vector and rejects equal-revision metadata changes', async () => {
    const base = await projectBaseToken(project);
    expect(base).toEqual(vectors.projectBase);
    const edited = await projectBaseToken({ ...project, settings: { ...project.settings, theme: 'moss' } });
    expect(edited.contentHash).toBe(base.contentHash);
    expect(edited.stateDigest).not.toBe(base.stateDigest);
    expect(sameBaseToken(base, edited)).toBe(false);
    expect(sameBaseToken(base, await projectBaseToken({ ...project, updatedAt: '2026-12-01T00:00:00Z' }))).toBe(true);
    expect(sameBaseToken(base, await projectBaseToken({ ...project, revision: project.revision + 1 }))).toBe(false);
    expect(sameBaseToken(base, await projectBaseToken({ ...project, id: 'other-project' }))).toBe(false);
  });

  it('sorts keys by code unit, preserves array order and preserves paired Unicode', () => {
    expect(canonicalJson({ b: 2, a: 1, '\u{1f510}': '🔐', '\uffff': true })).toBe('{"a":1,"b":2,"🔐":"🔐","\uffff":true}');
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson('\ufeffflowchart LR')).toBe('"\ufeffflowchart LR"');
    expect(canonicalJson('"\\')).toBe(JSON.stringify('"\\'));
  });

  it('hashes typed chart inputs separately from authored headings', async () => {
    const chart = { documentKind: 'chart' as const, id: 'chart', revision: 0, updatedAt: 'now', dataset: { cells: ['0.2'] }, chartSpec: { kind: 'bar' }, title: 'Original' };
    const before = await projectBaseToken(chart);
    const changedTitle = await projectBaseToken({ ...chart, title: 'Edited' });
    expect(changedTitle.contentHash).toBe(before.contentHash);
    expect(changedTitle.stateDigest).not.toBe(before.stateDigest);
    const changedData = await projectBaseToken({ ...chart, dataset: { cells: ['0.3'] } });
    expect(changedData.contentHash).not.toBe(before.contentHash);
  });

  it('rejects unsupported JSON values, unsafe integers and malformed arrays', async () => {
    expect(() => canonicalJson({ x: undefined })).toThrow('NON_JSON_VALUE');
    expect(() => canonicalJson(NaN)).toThrow('NONFINITE_NUMBER');
    expect(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1)).toThrow('UNSAFE_INTEGER');
    expect(() => canonicalJson(JSON.parse('{"__proto__":1}'))).toThrow('FORBIDDEN_KEY');
    expect(() => canonicalJson(new Date())).toThrow('NON_JSON_OBJECT');
    expect(() => canonicalJson(Object.assign(new Array(1), { other: true }))).toThrow('SPARSE_ARRAY');
    expect(() => canonicalJson(new Array(1))).toThrow('SPARSE_ARRAY');
    expect(() => canonicalJson('nested', 65)).toThrow('DEPTH_LIMIT');
    await expect(projectBaseToken({ ...project, revision: -1 })).rejects.toThrow('INVALID_REVISION');
  });
});
