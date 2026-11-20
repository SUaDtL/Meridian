import { describe, expect, it } from 'vitest';
import { applyDesignPreset, createDesign, designRenderSource, DESIGN_PRESETS, edgeIdentities, suggestedLayout, validateDesign, type FlowModel } from './design';
import type { RenderElement } from '../types/design';

const model: FlowModel = {
  vertices: new Map([['A', { id: 'A', text: 'Client', styles: ['fill:#ffffff', 'stroke:#123456'] }], ['B', { id: 'B', text: 'Service' }]]),
  groups: [{ id: 'network', title: 'Network', nodes: ['A', 'B'] }],
  edges: [{ id: 'L_A_B_0', start: 'A', end: 'B', text: 'Request', style: ['stroke:#667788'] }],
};

describe('persistent design model', () => {
  it('validates every preset and gives each document an independent style map', () => {
    for (const preset of DESIGN_PRESETS) {
      const result = applyDesignPreset({ design: createDesign() }, preset.id);
      expect(validateDesign(result.design).preset).toBe(preset.id);
      expect(result.settings.theme).toBe(preset.settings.theme);
    }
    const first = createDesign(), second = createDesign(); first.elements['node:A'] = { fill: '#123456' };
    expect(second.elements).toEqual({});
  });
  it('accepts bounded styles and keeps individual overrides when applying a preset', () => {
    const design = validateDesign({ preset: 'custom', elements: { 'node:A': { fill: '#ffffff', shape: 'diamond', fontSize: 24, strokeWidth: 3, shadow: false, emphasis: 'muted' } } });
    const next = applyDesignPreset({ design }, 'executive');
    expect(next.design.elements['node:A']).toEqual(design.elements['node:A']);
    expect(next.design.elements).not.toBe(design.elements);
  });
  it.each([
    { fill: 'url(https://example.com)' }, { font: 'Arial; background:red' },
    { fontSize: 10000 }, { strokeWidth: 0 }, { glow: 'false' }, { unknown: true },
  ])('rejects unsafe or unsupported element properties: %j', style => {
    expect(() => validateDesign({ preset: 'custom', elements: { 'node:A': style } })).toThrow();
  });
  it('rejects prototype names, malformed keys, unknown presets and excessive sidecars', () => {
    expect(() => validateDesign(JSON.parse('{"preset":"custom","elements":{"__proto__":{"fill":"#ffffff"}}}'))).toThrow();
    expect(() => validateDesign({ preset: 'custom', elements: { 'not-an-element': {} } })).toThrow();
    expect(() => validateDesign({ preset: 'alien', elements: {} })).toThrow();
    expect(() => validateDesign({ preset: 'custom', elements: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`node:${i}`, {}])) })).toThrow();
  });
});

describe('source-safe identity and layout overrides', () => {
  it('keeps implicit edge identity across unrelated insertions and names parallel edges separately', () => {
    const original = edgeIdentities(model.edges)[0];
    const moved = edgeIdentities([{ start: 'X', end: 'Y', text: 'Other' }, ...model.edges]);
    expect(moved[1]).toBe(original);
    const parallel = edgeIdentities([model.edges[0], model.edges[0]]);
    expect(new Set(parallel).size).toBe(2);
    expect(edgeIdentities([{ ...model.edges[0], id: 'request', isUserDefinedId: true }])[0]).toBe('edge:id:request');
  });
  it('appends preview geometry commands without changing the source or replacing authored styles', () => {
    const source = 'flowchart LR\n  A[Client] -->|Request| B[Service]\n  style A fill:#ffffff,stroke:#123456';
    const design = createDesign();
    design.elements['node:A'] = { shape: 'diamond', font: 'serif', fontSize: 24, fill: '#abcdef' };
    design.elements[edgeIdentities(model.edges)[0]] = { routing: 'orthogonal', fontSize: 18 };
    const preview = designRenderSource(source, design, model);
    expect(preview.slice(0, source.length)).toBe(source);
    expect(preview).toContain('A@{ shape: diamond }');
    expect(preview).toContain('style A fill:#ffffff,stroke:#123456,font-family:Georgia,font-size:24px');
    expect(preview).toContain('linkStyle 0 interpolate step stroke:#667788,font-size:18px');
    expect(preview).not.toContain('fill:#abcdef'); // Color is applied to sanitized SVG after layout.
  });
  it('does not add missing nodes for stale styles or reinterpret punctuation as Mermaid commands', () => {
    const design = createDesign(); design.elements['node:missing'] = { shape: 'circle' }; design.elements['node:A;X-->Y'] = { fontSize: 40 };
    expect(designRenderSource('flowchart LR\nA-->B', design, model)).toBe('flowchart LR\nA-->B');
  });
  it('chooses routes around grouped graphs and generous spacing for simple flows', () => {
    expect(suggestedLayout([])).toEqual({ layout: 'dagre', spacing: 'airy', curve: 'basis' });
    expect(suggestedLayout([{ kind: 'group' } as RenderElement]).layout).toBe('elk');
  });
});
