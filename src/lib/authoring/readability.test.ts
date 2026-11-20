import { expect, test } from 'vitest';
import { analyzeReadability, viewingScale, type ReadabilityTarget } from './readability';

const node = (id: string, label: string, measuredLabelSize?: number): ReadabilityTarget =>
  ({ id, label, measuredLabelSize, kind: 'node', typography: true, from: null, to: null });
const frame = { width: 1000, height: 500, diagramScale: 1.25 };
const profile = { width: 500, height: 400, padding: 10 };

test('fits viewed text once in CSS pixels and reports unknown measurements separately', () => {
  expect(viewingScale(profile, frame)).toBe(0.6);
  const report = analyzeReadability([node('a', 'Start', 20), node('b', 'Finish')], profile, frame);
  expect(report.findings).toContainEqual({ rule: 'QC-03', target: 'a', pixels: 12 });
  expect(report.coverage[0]).toEqual({ rule: 'QC-03', measured: 1, unknown: 1, inapplicable: 0 });
  expect(() => viewingScale({ ...profile, padding: 300 }, frame)).toThrow(/room inside/);
});

test('compares NFC and whitespace without changing display names or inventing connections', () => {
  const input: ReadabilityTarget[] = [node('a', 'Café API', 30), node('b', 'Cafe\u0301  API', 30), node('c', 'Warehouse', 30),
    { id: 'link', label: '', typography: false, kind: 'edge', from: 'b', to: 'a' }];
  const result = analyzeReadability(input, profile, frame);
  expect(result.findings).toEqual([{ rule: 'QC-05', targets: ['a', 'b'] }, { rule: 'QC-06', regions: [['a', 'b'], ['c']] }]);
  expect(input[1].label).toBe('Cafe\u0301  API');
  const group: ReadabilityTarget = { ...node('g', 'Team'), kind: 'group' };
  const withGroup = analyzeReadability([...input, group], profile, frame);
  expect(withGroup.findings).toEqual(result.findings);
  const withExplicitGroupEdge = analyzeReadability([...input, group,
    { id: 'bound', label: '', typography: false, kind: 'edge', from: 'g', to: 'a' }], profile, frame);
  expect(withExplicitGroupEdge.findings).toContainEqual({ rule: 'QC-06', regions: [['a', 'b', 'g'], ['c']] });
  expect(analyzeReadability([...input, { id: 'broken', label: '', typography: false, kind: 'edge', from: 'g', to: 'a' }],
    profile, frame).coverage[2].unknown).toBe(1);
});

test('uses viewed CSS pixels for label containment and leaves unsupported geometry unknown', () => {
  const input: ReadabilityTarget[] = [
    { ...node('outside', 'Spill', 30), labelOverflowInDiagram: 1 },
    { ...node('inside', 'Contained', 30), labelOverflowInDiagram: 0 },
    node('unsupported', 'Round shape', 30),
    { id: 'link', label: '', typography: false, kind: 'edge', from: 'outside', to: 'inside' },
  ];
  const result = analyzeReadability(input, profile, frame);
  expect(result.findings).toContainEqual({ rule: 'QC-04', target: 'outside', pixels: 0.6 });
  expect(result.coverage.find(item => item.rule === 'QC-04')).toEqual({ rule: 'QC-04', measured: 2, unknown: 1, inapplicable: 1 });
  const smaller = analyzeReadability(input, { ...profile, width: 250 }, frame);
  expect(smaller.findings.some(item => item.rule === 'QC-04')).toBe(false);
});
