import { describe, expect, it } from 'vitest';
import { flowchartSourceKey, layoutFingerprint, renderDiagram, renderFingerprint } from './render';
import { DEFAULT_SETTINGS } from './themes';
import { createDesign } from './design';
import { RenderCache } from './render-cache';
import { latestRenderQueue } from './render-queue';
import type { StudioSettings } from '../types';

describe('render boundary', () => {
  it('rejects empty and oversized source before touching a browser DOM', async () => {
    await expect(renderDiagram('  ', DEFAULT_SETTINGS, {})).rejects.toThrow('Add some Mermaid source');
    await expect(renderDiagram('a'.repeat(100_001), DEFAULT_SETTINGS, {})).rejects.toThrow('100,000');
  });

  it.each([
    'flowchart LR\nA@{ img: "https://example.com/pixel" }',
    'flowchart LR\nA["<img src=https://example.com/pixel>"]',
    'flowchart LR\nA["![remote](https://example.com/pixel)"]',
  ])('prevents image fetches during Mermaid measurement: %s', async (source) => {
    await expect(renderDiagram(source, DEFAULT_SETTINGS, {})).rejects.toThrow('Images and embedded HTML');
  });

  it.each([
    'flowchart LR\nA-->B\nclassDef remote fill:url(https://example.com/pixel)',
    'flowchart LR\nA-->B\nclassDef remote fill:\\75rl(https://example.com/pixel)',
    'flowchart LR\nA-->B\nclassDef remote fill:u\\rl(https://example.com/pixel)',
    'flowchart LR\nA-->B\nclassDef remote fill:u/**/rl(https://example.com/pixel)',
    'flowchart LR\nA-->B\nclassDef remote fill:image-set("https://example.com/pixel")',
  ])('blocks direct and escaped external CSS resource references: %s', async (source) => {
    await expect(renderDiagram(source, DEFAULT_SETTINGS, {})).rejects.toThrow('CSS URLs and external resources');
  });
});

describe('render invalidation', () => {
  const source = 'flowchart LR\nA-->B';
  const fingerprint = (settings = DEFAULT_SETTINGS) => renderFingerprint(source, settings, {});

  it('does not invalidate Mermaid for any framing-only setting', () => {
    const frame: Partial<StudioSettings> = { background: 'grid', ambient: !DEFAULT_SETTINGS.ambient, frame: '1:1', padding: 120, showTitle: !DEFAULT_SETTINGS.showTitle, showBrand: !DEFAULT_SETTINGS.showBrand };
    for (const [key, value] of Object.entries(frame)) {
      expect(fingerprint({ ...DEFAULT_SETTINGS, [key]: value }), key).toBe(fingerprint());
    }
  });

  it('reuses measured geometry for decoration but invalidates its displayed result', () => {
    const changed = { ...DEFAULT_SETTINGS, motion: 'pulse' as const, speed: 2, edgeWidth: 3, finish: 'solid' as const, shadow: !DEFAULT_SETTINGS.shadow, glow: !DEFAULT_SETTINGS.glow };
    expect(fingerprint(changed)).not.toBe(fingerprint());
    expect(layoutFingerprint(source, changed)).toBe(layoutFingerprint(source, DEFAULT_SETTINGS));
    const design = { ...createDesign(), elements: { 'node:A': { fill: '#ff0000', strokeWidth: 3, glow: true } } };
    expect(layoutFingerprint(source, DEFAULT_SETTINGS, design)).toBe(layoutFingerprint(source, DEFAULT_SETTINGS));
    expect(renderFingerprint(source, DEFAULT_SETTINGS, {}, design)).not.toBe(fingerprint());
  });

  it('invalidates geometry for source, native theme, layout, and measured element styles', () => {
    const base = layoutFingerprint(source, DEFAULT_SETTINGS);
    expect(layoutFingerprint(source + '\nB-->C', DEFAULT_SETTINGS)).not.toBe(base);
    for (const patch of [{ theme: 'porcelain' }, { layout: 'dagre' }, { curve: 'linear' }, { spacing: 'airy' }, { font: 'mono' }] as Partial<StudioSettings>[]) {
      const settings = { ...DEFAULT_SETTINGS, ...patch };
      if (JSON.stringify(settings) !== JSON.stringify(DEFAULT_SETTINGS)) expect(layoutFingerprint(source, settings)).not.toBe(base);
    }
    for (const style of [{ shape: 'circle' }, { font: 'serif' }, { fontSize: 22 }, { fontWeight: 'bold' }, { routing: 'direct' }] as const) {
      expect(layoutFingerprint(source, DEFAULT_SETTINGS, { ...createDesign(), elements: { 'node:A': style } })).not.toBe(base);
    }
    expect(layoutFingerprint(source, DEFAULT_SETTINGS, { ...createDesign(), preset: 'infrastructure' })).not.toBe(base);
  });

  it('uses canonical override ordering and includes accents', () => {
    const left = { ...createDesign(), elements: { 'node:A': { fill: '#ff0000', fontSize: 20 }, 'node:B': { stroke: '#00ff00' } } };
    const right = { ...createDesign(), elements: { 'node:B': { stroke: '#00ff00' }, 'node:A': { fontSize: 20, fill: '#ff0000' } } };
    expect(renderFingerprint(source, DEFAULT_SETTINGS, { A: '#fff', B: '#000' }, left)).toBe(renderFingerprint(source, DEFAULT_SETTINGS, { B: '#000', A: '#fff' }, right));
    expect(renderFingerprint(source, DEFAULT_SETTINGS, { A: '#fff' })).not.toBe(fingerprint());
  });
});

describe('bounded render caches', () => {
  it('evicts least recently used entries when either count or byte budget is exceeded', () => {
    const cache = new RenderCache<string>(2, 30);
    cache.set('a', 'first', 8);
    cache.set('b', 'second', 8);
    expect(cache.get('a')).toBe('first');
    cache.set('c', 'third', 8);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('first');
    cache.set('d', 'larger', 20);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeUndefined();
    expect(cache.get('d')).toBe('larger');
  });

  it('does not keep oversized entries and accounts for source-bearing cache keys', () => {
    const cache = new RenderCache<string>(4, 20);
    cache.set('a', 'small', 8);
    cache.set('a', 'oversized', 21);
    expect(cache.get('a')).toBeUndefined();
    cache.set('a'.repeat(11), 'small body, large key', 0);
    expect(cache.get('a'.repeat(11))).toBeUndefined();
  });
});

describe('latest-only render scheduling', () => {
  const deferred = () => {
    let release!: () => void;
    const promise = new Promise<void>(resolve => { release = resolve; });
    return { promise, release };
  };

  it('keeps Mermaid serial and skips every superseded waiting layout', async () => {
    const first = deferred();
    const started: string[] = [];
    let concurrent = 0;
    let maximum = 0;
    const queue = latestRenderQueue(async (input: string) => {
      concurrent++; maximum = Math.max(maximum, concurrent); started.push(input);
      if (input === 'first') await first.promise;
      concurrent--;
      return input;
    });
    const initial = queue.submit('first', 'first').catch(error => error.name);
    await Promise.resolve();
    const discarded = Array.from({ length: 25 }, (_, index) => queue.submit(`edit-${index}`, `edit-${index}`).catch(error => error.name));
    const newest = queue.submit('latest', 'latest');
    first.release();
    expect(await initial).toBe('AbortError');
    expect(await Promise.all(discarded)).toEqual(Array(25).fill('AbortError'));
    expect(await newest).toBe('latest');
    expect(started).toEqual(['first', 'latest']);
    expect(maximum).toBe(1);
  });

  it('shares an in-flight request without one consumer aborting the others', async () => {
    const task = deferred();
    let runs = 0;
    const queue = latestRenderQueue(async (input: number) => { runs++; await task.promise; return input; });
    const controller = new AbortController();
    const one = queue.submit('same', 7, controller.signal).catch(error => error.name);
    const two = queue.submit('same', 7);
    controller.abort(); task.release();
    expect(await one).toBe('AbortError');
    expect(await two).toBe(7);
    expect(runs).toBe(1);
  });

  it('does not execute an already-aborted or superseded synchronous request', async () => {
    const started: string[] = [];
    const queue = latestRenderQueue(async (input: string) => { started.push(input); return input; });
    const controller = new AbortController(); controller.abort();
    await expect(queue.submit('abort', 'abort', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const old = queue.submit('old', 'old').catch(error => error.name);
    const fresh = queue.submit('fresh', 'fresh');
    expect(await old).toBe('AbortError');
    expect(await fresh).toBe('fresh');
    expect(started).toEqual(['fresh']);
  });

  it('recovers after a failed layout instead of poisoning the queue', async () => {
    const queue = latestRenderQueue(async (input: string) => { if (input === 'bad') throw new Error('Parse error'); return input; });
    await expect(queue.submit('bad', 'bad')).rejects.toThrow('Parse error');
    expect(await queue.submit('good', 'good')).toBe('good');
  });
});

describe('Mermaid 12 flowchart adapter', () => {
  it('recognizes the observed render-ID-prefixed node IDs', () => {
    expect(flowchartSourceKey('meridian-1-flowchart-endpoint-0', 'meridian-1')).toBe('endpoint');
    expect(flowchartSourceKey('meridian-12-flowchart-edge-router-34', 'meridian-12')).toBe('edge-router');
  });

  it('does not erase pieces of source node names or invent keys for other diagram types', () => {
    expect(flowchartSourceKey('meridian-1-flowchart-meridian-1-gateway-3', 'meridian-1')).toBe('meridian-1-gateway');
    expect(flowchartSourceKey('flowchart-client-0', 'meridian-1')).toBe('client');
    expect(flowchartSourceKey('meridian-1-classId-User-0', 'meridian-1')).toBeUndefined();
  });
});
