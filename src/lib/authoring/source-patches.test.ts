import { describe, expect, it } from 'vitest';
import { applySourcePatches, planEdgeAddition, planEdgeRemoval, planNodeAddition, planNodeLabel } from './source-patches';

const source = [
  '\uFEFFflowchart LR',
  '  %% remain; "quoted text',
  '  Alpha["Board; 1"]; Beta("Finish")',
  '  Alpha first@-->|"Via; A"| Beta',
  '  Alpha second@--> Beta',
  '  linkStyle 0 stroke:#ff0000',
  '  linkStyle 0,1 stroke-width:3px',
  '  linkStyle 1 stroke:#00ff00',
  '  linkStyle default stroke:#0000ff',
  '',
].join('\r\n');

describe('bounded top-level source edit spike', () => {
  it('renames only the label span while preserving BOM, CRLF, quotes and comments', () => {
    const patches = planNodeLabel(source, 'Alpha', 'A|β');
    expect(patches).toHaveLength(1);
    expect(applySourcePatches(source, patches)).toBe(source.replace('"Board; 1"', '"A#124;β"'));
    expect(applySourcePatches(source, planNodeLabel(source, 'Alpha', 'Board; 1'))).toBe(source);
    expect(planNodeLabel('graph TD\nA[Review]\n', 'A', 'Review')).toEqual([]);
  });

  it('appends a node and explicit edge without changing older indices or the final comment', () => {
    const original = 'flowchart TD\r\n  m_n1[Start]\r\n  End[Finish]\r\n  m_n1 m_e1@--> End\r\n  linkStyle 0 stroke:red\r\n  %% final comment';
    const node = planNodeAddition(original, 'Result', 'rounded');
    expect(node.sourceId).toBe('m_n2');
    const added = applySourcePatches(original, node.patches);
    expect(added).toBe(original + '\r\n  m_n2("Result")\r\n');
    const edge = planEdgeAddition(added, 'End', node.sourceId, 'Done');
    expect(edge.sourceId).toBe('m_e2');
    expect(applySourcePatches(added, edge.patches)).toBe(added + '  End m_e2@-->|"Done"| m_n2\r\n');
    expect(() => planEdgeAddition(original, 'Missing', 'End')).toThrow('declared nodes');
  });

  it('removes the named parallel edge and remaps the surviving index without reformatting', () => {
    const candidate = applySourcePatches(source, planEdgeRemoval(source, 'first'));
    expect(candidate).toBe(source
      .replace('Alpha first@-->|"Via; A"| Beta', '')
      .replace('linkStyle 0 stroke:#ff0000', '')
      .replace('linkStyle 0,1 stroke-width:3px', 'linkStyle 0 stroke-width:3px')
      .replace('linkStyle 1 stroke:#00ff00', 'linkStyle 0 stroke:#00ff00'));
  });

  it.each([
    'flowchart LR\nA[X]\nA[Y]',
    'flowchart LR\nA[X] --> B[Z]',
    'flowchart LR\nA[X]\nB[Z]\nA-->B',
    'flowchart LR\nA[X]\nclass A critical',
    'flowchart LR\nA[X]\nsubgraph N\nend',
    'flowchart LR\nA[X]\n%%{ignored}%%',
    'flowchart LR\nA[X]\nA["unterminated',
    'flowchart LR\nA[X]\nlinkStyle 9007199254740992 stroke:red',
    'flowchart LR\nA[X]\nA B@--> B',
  ])('declines unproven reference scopes in %j', (unsupported) => {
    expect(() => planNodeLabel(unsupported, 'A', 'New')).toThrow('source panel');
  });

  it('preserves very long horizontal whitespace without repeated searches', () => {
    const padding = ' '.repeat(98_000);
    const original = `flowchart LR\n  A[First${padding}step]  \n`;
    expect(applySourcePatches(original, planNodeLabel(original, 'A', 'Next'))).toBe('flowchart LR\n  A["Next"]  \n');
  });

  it('rejects stale spans and overlaps atomically', () => {
    const patches = planNodeLabel(source, 'Alpha', 'Changed');
    expect(() => applySourcePatches(source.replace('Board', 'Blank'), patches)).toThrow('changed');
    expect(() => applySourcePatches(source, [...patches, ...patches])).toThrow('changed');
    expect(() => applySourcePatches(source, [{ from: -1, to: 0, expectedText: '', replacement: '' }])).toThrow('changed');
    expect(() => applySourcePatches(source, [{ from: 0, to: 0, expectedText: '', replacement: ' '.repeat(100_000) }])).toThrow('limit');
  });
});
