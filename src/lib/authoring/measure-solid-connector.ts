import type { RenderElement } from '../../types/design';
import { boxesOverlap, hasPlainCompositing } from './measure-solid-text';
import { readSrgbPaint } from './solid-text-color';

type Bounds = NonNullable<RenderElement['bounds']>;
type SolidBackdrop = NonNullable<ReturnType<typeof readSrgbPaint>>;
const graphics = 'path, rect, circle, ellipse, polygon, polyline, line, text, tspan, image, use';

function expand({ x, y, width, height }: Bounds, padding: number): Bounds {
  return { x: x - padding, y: y - padding, width: width + padding * 2, height: height + padding * 2 };
}

/** Bound other paint conservatively before sampling a connector's exposed core. */
function obstruction(svg: SVGSVGElement, target: SVGGraphicsElement, bounds: Bounds, inverse: DOMMatrix, view: Window) {
  const shapes = target.matches(graphics) ? [target] : [...target.querySelectorAll<SVGGraphicsElement>(graphics)];
  if (!shapes.length || shapes.length > 64) return;
  let radius = 0;
  for (const shape of shapes) {
    if (!hasPlainCompositing(shape, svg, view, false) || shape.matches('image, use')) return;
    const style = view.getComputedStyle(shape);
    if ([style.markerStart, style.markerMid, style.markerEnd].some(marker => marker !== 'none')) return;
    if (style.stroke === 'none') continue;
    if (style.vectorEffect !== 'none') return;
    const matrix = shape.getScreenCTM();
    if (!matrix) return;
    const { a, b, c, d } = inverse.multiply(matrix);
    const margin = Number.parseFloat(style.strokeWidth) * Math.max(2, Number(style.strokeMiterlimit)) * Math.hypot(a, b, c, d);
    if (!Number.isFinite(margin) || margin < 0) return;
    radius = Math.max(radius, margin);
  }
  return expand(bounds, radius);
}

/** Sample single straight, unmarked shafts in a verified solid canvas.
 * Curves, arrowheads, overlays and unproven backdrop regions stay unknown.
 */
export function measureSolidConnectors(
  svg: SVGSVGElement, elements: RenderElement[], targets: ReadonlyMap<string | null, SVGGraphicsElement>,
  backdrop: SolidBackdrop, inverse: DOMMatrix, view: Window,
) {
  if (elements.length > 150 || backdrop.opacity !== 1) return;
  const blockers = new Map<string, Bounds>();
  for (const item of elements) {
    const target = targets.get(item.key);
    const bounds = target && item.bounds && obstruction(svg, target, item.bounds, inverse, view);
    if (!bounds) return;
    blockers.set(item.key, bounds);
  }
  for (const item of elements) {
    const path = targets.get(item.key);
    if (item.kind !== 'edge' || path?.localName !== 'path' || !item.appearance || !item.measuredRoute) continue;
    const style = view.getComputedStyle(path);
    const dash = style.strokeDasharray;
    if (style.fill !== 'none' || (dash !== 'none' && !/^(?:0(?:px)?[ ,]*)+$/.test(dash))) continue;
    const stroke = readSrgbPaint(style.stroke);
    const width = Number.parseFloat(style.strokeWidth);
    const opacity = (stroke?.opacity ?? 0) * Number(style.strokeOpacity);
    if (!stroke || !(opacity > 0 && opacity <= 1) || !Number.isFinite(width) || width <= 0) continue;
    try {
      const route = path as SVGPathElement;
      const matrix = path.getScreenCTM();
      const length = route.getTotalLength();
      if (!matrix || !Number.isFinite(length) || length <= width * 8) continue;
      const start = route.getPointAtLength(0), end = route.getPointAtLength(length);
      if (Math.abs(Math.hypot(end.x - start.x, end.y - start.y) - length) > 0.001) continue;
      const transform = inverse.multiply(matrix);
      const center = route.getPointAtLength(length / 2).matrixTransform(transform);
      const radius = width * 2 * Math.hypot(transform.a, transform.b, transform.c, transform.d);
      if (!Number.isFinite(radius) || !Number.isFinite(center.x) || !Number.isFinite(center.y)) continue;
      const sample = expand({ x: center.x, y: center.y, width: 0, height: 0 }, radius);
      if ([...blockers].some(([id, bounds]) => id !== item.key && boxesOverlap(sample, bounds))) continue;
      item.appearance.solidConnectorPaint = { backing: backdrop.channels, stroke: { channels: stroke.channels, opacity } };
    } catch { /* Unavailable geometry stays unknown. */ }
  }
}
