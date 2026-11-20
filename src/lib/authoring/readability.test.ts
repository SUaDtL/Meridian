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
  expect(analyzeReadability([...input, { ...node('g', 'Team'), kind: 'group' }], profile, frame).coverage[2].unknown).toBe(1);
});
