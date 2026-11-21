import { expect, test } from 'vitest';
import { analyzeCrossings } from './crossing-findings';
import { flattenRoute, type RoutePoint } from './route-geometry';

const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

test('measures absolute line and cubic routes after the common diagram transform', () => {
  const matrix = { a: 2, b: 0, c: 0, d: 2, e: 10, f: -2 };
  const route = flattenRoute('M0,0 0,4 C0,20 16,20 16,4 L16,0', matrix, { remaining: 100 });
  expect(route?.[0]).toEqual([10, -2]);
  expect(route?.[1]).toEqual([10, 6]);
  expect(route).toContainEqual([26, 30]);
  expect(route?.at(-1)).toEqual([42, -2]);
  const quadratic = flattenRoute('M0,0 Q6,6 12,0', identity, { remaining: 100 });
  expect(quadratic).toContainEqual([6, 3]);
  expect(flattenRoute('M0,0 A10 10 0 0 0 20 20', identity, { remaining: 10 })).toBeUndefined();
  const budget = { remaining: 1 };
  expect(flattenRoute('M0,0 L5,5 10,10', identity, budget)).toBeUndefined();
  expect(budget.remaining).toBe(0);
});

const edge = (id: string, ...measuredRoute: RoutePoint[]) => ({ id, kind: 'edge', measuredRoute });

test('counts proper crossings and leaves route joins and unsupported paths out of measured findings', () => {
  const { findings, coverage } = analyzeCrossings([
    edge('first', [0, 0], [10, 10]), edge('second', [0, 10], [10, 0]), edge('join', [10, 10], [20, 20]),
    { id: 'unknown', kind: 'edge' },
  ]);
  expect(findings).toEqual([{ rule: 'QC-07', targets: ['first', 'second'], count: 1, first: [5, 5] }]);
  expect(coverage).toEqual({ rule: 'QC-07', measured: 3, unknown: 1, inapplicable: 0 });
});

test('bounds the complete sweep and reports exactly how many pairs were skipped', () => {
  const result = analyzeCrossings(Array.from({ length: 500 }, (_, index) => edge(String(index), [0, index], [100, index])));
  expect(result.evidence).toEqual({ checked: 100_000, skipped: 24_750, findingsOmitted: false });
  expect(result.findings).toEqual([]);
});
