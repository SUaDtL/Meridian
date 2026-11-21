import { describe, expect, it } from 'vitest';
import { applySourcePatches, planEdgeAddition, planEdgeLabel, planEdgeRemoval, planGroupContentsRemoval, planGroupCreation, planGroupRemoval, planMoveToGroup, planNodeAddition, planNodeLabel, planNodeRemoval, supportedGroupMoves } from './source-patches';

it('wraps a consecutive authored range and leaves comments and relationship lines byte-exact', () => {
  const source = '\uFEFFflowchart LR\r\n  A[First]\r\n  %% Between declarations\r\n  B[Second] %% Keep this comment\r\n  C[Last]\r\n  A first@--> B\r\n  B second@--> C\r\n';
  const plan = planGroupCreation(source, ['B', 'A'], 'First two');
  expect(plan.sourceId).toBe('m_g1');
  const grouped = applySourcePatches(source, plan.patches);
  expect(grouped).toBe(
    '\uFEFFflowchart LR\r\n  subgraph m_g1 ["First two"]\r\n  A[First]\r\n  %% Between declarations\r\n  B[Second] %% Keep this comment\r\n  end\r\n  C[Last]\r\n  A first@--> B\r\n  B second@--> C\r\n',
  );
  expect(() => planGroupCreation(source, ['A', 'C'], 'Separate statements')).toThrow('consecutive node declarations');
  expect(() => planGroupCreation(source, ['A', 'A'], 'Repeated member')).toThrow('current node declarations');
  const inverse = planGroupRemoval(grouped, 'm_g1');
  expect(inverse.memberIds).toEqual(['A', 'B']);
  expect(applySourcePatches(grouped, inverse.patches)).toBe(source);
  const nested = grouped.replace('  A[First]', '  subgraph nested [Nested]\r\n  A[First]').replace('  B[Second]', '  end\r\n  B[Second]');
  expect(() => planGroupRemoval(nested, 'm_g1')).toThrow('source panel');
});

it('moves the exact standalone line and omits members and shared source lines', () => {
  const line = '  B[Outside] %% Keep with B\r\n';
  const source = '\uFEFFflowchart LR\r\n' + line + '  subgraph Team [Team]\r\n  A[Member]\r\n  end\r\n  C[Shared]; D[Shared]\r\n  A link@--> B\r\n';
  expect(supportedGroupMoves(source, 'Team')).toEqual(['B']);
  const plan = planMoveToGroup(source, 'B', 'Team');
  expect(applySourcePatches(source, plan.patches)).toBe(source.replace(line, '').replace('  end\r\n', line + '  end\r\n'));
  expect(() => planMoveToGroup(source, 'A', 'Team')).toThrow('outside node');
  expect(() => planMoveToGroup(source, 'C', 'Team')).toThrow('own source line');
});

it('requires the full group deletion footprint and leaves all unidentified connections untouched', () => {
  const source = 'flowchart LR\n subgraph Team [Team]\n A[First]\n B[Second]\n end\n C[Outside]\n A inside@--> B\n B crossing@--> C\n';
  expect(() => planGroupContentsRemoval(source, 'Team', ['A'], ['inside'])).toThrow('every current group member');
  expect(() => planGroupContentsRemoval(source, 'Team', ['A', 'B'], ['inside'])).toThrow('all incident connections');
  expect(() => planGroupContentsRemoval(source.replace('crossing@', ''), 'Team', ['A', 'B'], ['inside'])).toThrow('explicit source ID');
  expect(() => planGroupContentsRemoval(source.replace(' C[Outside]\n', '').replace(' B crossing@--> C\n', ''),
    'Team', ['A', 'B'], ['inside'])).toThrow('Keep at least one node');
});

it('removes only the exact incident set and preserves unaffected linkStyle positions', () => {
  const source = 'flowchart LR\nA[First]\nB[Middle] %% keep this\nC[Last]\nA incoming@--> B\nA kept@--> C\nB outgoing@--> C\nB loop@--> B\nlinkStyle 0,1,2,3 stroke:#123456\n';
  expect(applySourcePatches(source, planNodeRemoval(source, 'B', ['outgoing', 'incoming', 'loop']))).toBe(
    'flowchart LR\nA[First]\n %% keep this\nC[Last]\n\nA kept@--> C\n\n\nlinkStyle 0 stroke:#123456\n',
  );
  for (const incomplete of [['incoming', 'outgoing'], ['incoming', 'outgoing', 'loop', 'kept'], ['incoming', 'outgoing', 'loop', 'loop']]) {
    expect(() => planNodeRemoval(source, 'B', incomplete)).toThrow('Review all incident connections');
  }
  expect(() => planNodeRemoval(source.replace('loop@', ''), 'B', ['incoming', 'outgoing'])).toThrow('explicit source ID');
  expect(() => planNodeRemoval('flowchart LR\nA[Single]\n', 'A', [])).toThrow('Keep at least one node');
});

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

it('edits only the explicit connection label token and keeps comments and spacing exact', () => {
  const source = '\uFEFFflowchart LR\r\n  A[First]\r\n  B[Second]\r\n  A first@-->|"Old label"|  B %% retained\r\n  A second@--> B\r\n  A --> B\r\n  linkStyle 1 stroke:#123456\r\n';
  const renamed = applySourcePatches(source, planEdgeLabel(source, 'first', 'New label'));
  expect(renamed).toBe(source.replace('|"Old label"|', '|"New label"|'));
  expect(applySourcePatches(renamed, planEdgeLabel(renamed, 'first', ''))).toBe(source.replace('|"Old label"|', ''));
  expect(applySourcePatches(source, planEdgeLabel(source, 'second', 'Added'))).toBe(source.replace('second@-->', 'second@-->|"Added"|'));
  expect(planEdgeLabel(source, 'second', '')).toEqual([]);
  expect(() => planEdgeLabel(source, 'unknown', 'Label')).toThrow('explicit source ID');
});
