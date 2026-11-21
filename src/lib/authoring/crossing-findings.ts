import { routeSegmentLimit, type RoutePoint } from './route-geometry';

type Segment = { edge: string; a: RoutePoint; b: RoutePoint; minX: number; maxX: number; minY: number; maxY: number };
export type CrossingFinding = { rule: 'QC-07'; targets: [string, string]; count: number; first: RoutePoint };
export type CrossingEvidence = { checked: number; skipped: number; count: number; findingsOmitted: boolean };
export type CrossingSummary = { count: number; measured: number; unknown: number; checked: number; skipped: number };
export type LayoutCrossingComparison = { current: CrossingSummary; proposed: CrossingSummary };

const pairLimit = 100_000;
const findingLimit = 200;
const endpointTolerance = 1e-8;

function crossing(left: Segment, right: Segment): RoutePoint | undefined {
  const x = left.b[0] - left.a[0], y = left.b[1] - left.a[1];
  const dx = right.b[0] - right.a[0], dy = right.b[1] - right.a[1];
  const determinant = x * dy - y * dx;
  if (Math.abs(determinant) < endpointTolerance) return undefined;
  const ox = right.a[0] - left.a[0], oy = right.a[1] - left.a[1];
  const t = (ox * dy - oy * dx) / determinant;
  const u = (ox * y - oy * x) / determinant;
  if (Math.min(t, u) <= endpointTolerance || Math.max(t, u) >= 1 - endpointTolerance) return undefined;
  return [left.a[0] + t * x, left.a[1] + t * y];
}

function lastCandidate(segments: readonly Segment[], index: number) {
  let low = index + 1;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (segments[middle].minX <= segments[index].maxX) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Review proper intersections only, with explicit accounting for incomplete coverage. */
export function analyzeCrossings(targets: readonly { id: string; kind: string; measuredRoute?: RoutePoint[] }[]) {
  const coverage = { rule: 'QC-07' as const, measured: 0, unknown: 0, inapplicable: 0 };
  const segments: Segment[] = [];
  for (const target of targets) {
    if (target.kind !== 'edge') { coverage.inapplicable++; continue; }
    const route = target.measuredRoute;
    if (!route || route.length < 2 || route.length - 1 > routeSegmentLimit - segments.length) { coverage.unknown++; continue; }
    const start = segments.length;
    for (let index = 1; index < route.length; index++) {
      const a = route[index - 1], b = route[index];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      segments.push({ edge: target.id, a, b, minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]),
        minY: Math.min(a[1], b[1]), maxY: Math.max(a[1], b[1]) });
    }
    if (segments.length === start) coverage.unknown++;
    else coverage.measured++;
  }
  segments.sort((a, b) => a.minX - b.minX);
  const ends = segments.map((_, index) => lastCandidate(segments, index));
  const candidates = ends.reduce((sum, end, index) => sum + end - index - 1, 0);
  const found = new Map<string, CrossingFinding>();
  let checked = 0;
  let count = 0;
  let findingsOmitted = false;
  for (let index = 0; index < segments.length && checked < pairLimit; index++) {
    const left = segments[index];
    for (let next = index + 1; next < ends[index] && checked < pairLimit; next++) {
      checked++;
      const right = segments[next];
      if (left.edge === right.edge || left.maxY < right.minY || right.maxY < left.minY) continue;
      const point = crossing(left, right);
      if (!point) continue;
      count++;
      const targets: [string, string] = left.edge < right.edge ? [left.edge, right.edge] : [right.edge, left.edge];
      const key = JSON.stringify(targets);
      const previous = found.get(key);
      if (previous) previous.count++;
      else if (found.size < findingLimit) found.set(key, { rule: 'QC-07', targets, count: 1, first: point });
      else findingsOmitted = true;
    }
  }
  const evidence: CrossingEvidence = { checked, skipped: candidates - checked, count, findingsOmitted };
  return { coverage, evidence, findings: [...found.values()] };
}
