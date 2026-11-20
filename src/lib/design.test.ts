import { describe, expect, it } from 'vitest';
import { applyDesignPreset, colorToHex, createDesign, designRenderSource, DESIGN_PRESETS, edgeIdentities, matchesDesignPreset, patchElementStyle, suggestedLayout, suggestedNodeFills, validateDesign, type FlowModel } from './design';
import { DEFAULT_SETTINGS, THEMES } from './themes';
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
  it('preserves heading visibility, signature, and chosen playback speed when applying a preset', () => {
    const result = applyDesignPreset({ design: createDesign(), settings: { ...DEFAULT_SETTINGS, showTitle: false, showBrand: true, speed: 2.5 } }, 'minimal');
    expect(result.settings).toMatchObject({ showTitle: false, showBrand: true, speed: 2.5, theme: 'porcelain', shadow: false });
  });
  it('marks a retained base preset as modified only when one of its controlled settings differs', () => {
    const { settings, design } = applyDesignPreset({ design: createDesign() }, 'infrastructure');
    expect(matchesDesignPreset(settings, design.preset)).toBe(true);
    expect(matchesDesignPreset({ ...settings, frame: '16:9' }, design.preset)).toBe(false);
    expect(matchesDesignPreset({ ...settings, motion: 'none' }, design.preset)).toBe(false);
    expect(matchesDesignPreset({ ...settings, theme: 'porcelain' }, design.preset)).toBe(false);
    expect(matchesDesignPreset({ ...settings, showTitle: false, showBrand: true, speed: 2 }, design.preset)).toBe(true);
    expect(design.preset).toBe('infrastructure');
    expect(matchesDesignPreset(settings, 'custom')).toBe(false);
  });
  it('resets one property independently and removes the final empty style entry', () => {
    const original = createDesign();
    original.elements['node:A'] = { fill: '#24686b', fontSize: 18, strokeWidth: 1.6 };
    const next = patchElementStyle(original, 'node:A', { fontSize: undefined });
    expect(next.elements['node:A']).toEqual({ fill: '#24686b', strokeWidth: 1.6 });
    expect(original.elements['node:A'].fontSize).toBe(18);
    const cleared = patchElementStyle(next, 'node:A', { fill: undefined, strokeWidth: undefined });
    expect(cleared.elements).toEqual({});
  });
  it('does not add no-op styles and represents normal emphasis and source arrows as inheritance', () => {
    const design = createDesign();
    expect(patchElementStyle(design, 'node:A', { fill: undefined })).toBe(design);
    expect(patchElementStyle(design, 'node:A', { emphasis: 'normal' })).toBe(design);
    const changed = patchElementStyle(design, 'edge:A', { arrowhead: 'both', strokeWidth: 1.6 });
    expect(patchElementStyle(changed, 'edge:A', { arrowhead: 'source' }).elements['edge:A']).toEqual({ strokeWidth: 1.6 });
    expect(patchElementStyle(changed, 'edge:A', { strokeWidth: 1.6 })).toBe(changed);
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
    expect(() => validateDesign({ preset: 'custom', elements: { 'node:': {} } })).toThrow();
    expect(() => validateDesign({ preset: 'alien', elements: {} })).toThrow();
    expect(() => validateDesign({ preset: 'custom', elements: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`node:${i}`, {}])) })).toThrow();
  });
  it('converts rendered solid colors accurately without treating gradients or transparency as solid hex', () => {
    expect(colorToHex('rgb(36, 104, 107)')).toBe('#24686b');
    expect(colorToHex('rgb(36 104 107)')).toBe('#24686b');
    expect(colorToHex('#AbC')).toBe('#aabbcc');
    expect(colorToHex('rgba(36, 104, 107, 0.5)')).toBeUndefined();
    expect(colorToHex('url(#surface)')).toBeUndefined();
    expect(colorToHex('not a color')).toBeUndefined();
  });
  it('offers quick fills with readable contrast against every theme’s default text', () => {
    const luminance = (hex: string) => [1, 3, 5].map(index => {
      const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    for (const theme of THEMES) for (const fill of suggestedNodeFills(theme)) {
      const foreground = luminance(theme.text), background = luminance(fill);
      expect((Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)).toBeGreaterThanOrEqual(4.5);
    }
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
  it('keeps authored group colors and border styles when measuring a typography override', () => {
    const grouped = { ...model, vertices: new Map([...model.vertices, ['network', { id: 'network', styles: ['fill:#123456', 'stroke:#aabbcc', 'stroke-width:2.3px'] }]]) };
    const design = createDesign(); design.elements['group:network'] = { fontSize: 22 };
    const source = 'flowchart LR\nsubgraph network[Network]\n A-->B\nend\nstyle network fill:#123456,stroke:#aabbcc,stroke-width:2.3px';
    expect(designRenderSource(source, design, grouped)).toContain('style network fill:#123456,stroke:#aabbcc,stroke-width:2.3px,font-size:22px');
  });
  it('chooses routes around grouped graphs and generous spacing for simple flows', () => {
    expect(suggestedLayout([])).toEqual({ layout: 'dagre', spacing: 'airy', curve: 'basis' });
    expect(suggestedLayout([{ kind: 'group' } as RenderElement]).layout).toBe('elk');
  });
});
