import { describe, expect, it } from 'vitest';
import { encodeMermaidLabel, writeFlowchart, type FlowchartInput } from './flowchart-source';
import { fixtures } from './fixtures/label-encoder-fixtures.json';

describe('canonical flowchart writing', () => {
  it.each(fixtures)('escapes $input per the design contract', ({ input, encodedToken }) => {
    expect(encodeMermaidLabel(input)).toBe(encodedToken);
  });

  it('preserves the exact edge list and separates duplicate display labels from identity', () => {
    const graph = writeFlowchart({
      direction: 'TB',
      nodes: [{ key: 'approve', label: 'Review' }, { key: 'decision', label: 'Check', shape: 'diamond' }, { key: 'reject', label: 'Review' }],
      edges: [{ from: 'decision', to: 'approve', label: 'Yes' }, { from: 'decision', to: 'reject', label: '' }],
    });
    expect(graph.source).toBe([
      'flowchart TB',
      '  m_n1["Review"]',
      '  m_n2{"Check"}',
      '  m_n3["Review"]',
      '  m_n2 m_e1@-->|"Yes"| m_n1',
      '  m_n2 m_e2@--> m_n3',
      '',
    ].join('\n'));
    expect([...graph.nodeIds]).toEqual([['approve', 'm_n1'], ['decision', 'm_n2'], ['reject', 'm_n3']]);
    expect(graph.edgeIds).toEqual(['m_e1', 'm_e2']);
  });

  it('counts code points and rejects malformed or multi-line generated labels', () => {
    expect(encodeMermaidLabel('🔐'.repeat(200))).toBe('"' + '🔐'.repeat(200) + '"');
    expect(() => encodeMermaidLabel('🔐'.repeat(201))).toThrow('200');
    for (const value of ['', '\uD800', 'a\uDFFF', 'a\u0085b', 'a\u2028b', 'a\nb']) {
      expect(() => encodeMermaidLabel(value)).toThrow();
    }
  });

  it('refuses duplicate keys, unknown endpoints and source expansion over the byte-independent limit', () => {
    const node = { key: 'A', label: 'A' };
    const input: FlowchartInput = { direction: 'LR', nodes: [node], edges: [] };
    expect(() => writeFlowchart({ ...input, nodes: [node, node] })).toThrow('distinct');
    expect(() => writeFlowchart({ ...input, edges: [{ from: 'A', to: 'B' }] })).toThrow('existing nodes');
    expect(() => writeFlowchart({ ...input, edges: Array(501).fill({ from: 'A', to: 'A' }) })).toThrow('500');
    expect(() => writeFlowchart({
      ...input,
      edges: Array(500).fill({ from: 'A', to: 'A', label: '#'.repeat(200) }),
    })).toThrow('source limit');
  });
});
