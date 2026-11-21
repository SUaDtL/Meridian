export type RoutePoint = readonly [number, number];
type Affine = Pick<DOMMatrix, 'a' | 'b' | 'c' | 'd' | 'e' | 'f'>;

export const routeTolerance = 0.5;
export const routeSegmentLimit = 10_000;
const coordinateLimit = 10_000_000;
const token = /[MLCQ]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[\s,]+|./gy;

function distanceFromSegment(point: RoutePoint, start: RoutePoint, end: RoutePoint) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const magnitude = dx * dx + dy * dy;
  const along = magnitude ? Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / magnitude)) : 0;
  return Math.hypot(point[0] - start[0] - along * dx, point[1] - start[1] - along * dy);
}

function midpoint(a: RoutePoint, b: RoutePoint): RoutePoint {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function quadraticControl(endpoint: RoutePoint, control: RoutePoint): RoutePoint {
  return [(endpoint[0] + 2 * control[0]) / 3, (endpoint[1] + 2 * control[1]) / 3];
}

/** Flatten one open absolute SVG route after transforming it into diagram space. */
export function flattenRoute(path: string, matrix: Affine, budget: { remaining: number; skipped: number }): RoutePoint[] | undefined {
  if (!budget.remaining) {
    budget.skipped++;
    return undefined;
  }
  if (path.length > 25_000 || ![matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].every(Number.isFinite)) return undefined;
  const parts = Array.from(path.matchAll(token), match => match[0]).filter(part => !/^[\s,]/.test(part));
  if (parts[0] !== 'M') return undefined;
  const points: RoutePoint[] = [];
  let index = 1;
  function read() {
    const x = Number(parts[index++]);
    const y = Number(parts[index++]);
    const point: RoutePoint = [matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f];
    if (!point.every(value => Number.isFinite(value) && Math.abs(value) <= coordinateLimit)) throw invalidRoute;
    return point;
  }
  function add(point: RoutePoint) {
    if (points.length) {
      if (budget.remaining <= 0) {
        budget.skipped++;
        throw invalidRoute;
      }
      budget.remaining--;
    }
    points.push(point);
  }
  function cubic(a: RoutePoint, b: RoutePoint, c: RoutePoint, d: RoutePoint, depth: number) {
    // The convex hull of the controls stays within this chord's tolerance.
    if (Math.max(distanceFromSegment(b, a, d), distanceFromSegment(c, a, d)) <= routeTolerance) {
      add(d);
      return;
    }
    if (depth >= 12) throw invalidRoute;
    const ab = midpoint(a, b), bc = midpoint(b, c), cd = midpoint(c, d);
    const abc = midpoint(ab, bc), bcd = midpoint(bc, cd);
    const center = midpoint(abc, bcd);
    cubic(a, ab, abc, center, depth + 1);
    cubic(center, bcd, cd, d, depth + 1);
  }
  try {
    add(read());
    let command = 'L';
    while (index < parts.length) {
      const current = parts[index];
      if (current === 'L' || current === 'C' || current === 'Q') { command = current; index++; }
      if (command === 'L') add(read());
      else if (command === 'C') cubic(points[points.length - 1], read(), read(), read(), 0);
      else {
        const start = points[points.length - 1];
        const control = read(), end = read();
        cubic(start, quadraticControl(start, control), quadraticControl(end, control), end, 0);
      }
    }
    return points.length > 1 ? points : undefined;
  } catch (reason) {
    if (reason !== invalidRoute) throw reason;
    return undefined;
  }
}

const invalidRoute = new Error('The route could not be measured within its geometry bounds.');
