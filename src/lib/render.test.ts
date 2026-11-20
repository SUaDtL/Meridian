import { describe, expect, it } from 'vitest';
import { flowchartSourceKey, renderDiagram } from './render';
import { DEFAULT_SETTINGS } from './themes';

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
