import { hasPlainCompositing, projectedBox, svgTextFragments } from './measure-solid-text';

function unrotated(transform: DOMMatrix): boolean {
  // Chromium can expose the legacy SVGMatrix shape for an SVG screen CTM.
  return transform.is2D !== false && [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f].every(Number.isFinite)
    && transform.a > 0 && transform.d > 0
    && Math.abs(transform.b) <= transform.a * 1e-8 && Math.abs(transform.c) <= transform.d * 1e-8;
}

/** Compare native text bounds to its own square-corner backing in diagram coordinates. */
export function measureLabelOverflow(svg: SVGSVGElement, shape: SVGElement | undefined, label: SVGElement | undefined,
  view: Window, toDiagram: DOMMatrix): number | undefined {
  if (shape?.localName !== 'rect') return undefined;
  const style = view.getComputedStyle(shape);
  if (['rx', 'ry'].some(property => {
    const value = style.getPropertyValue(property);
    return value !== 'auto' && Number.parseFloat(value) !== 0;
  }) || !hasPlainCompositing(shape, svg, view)) return undefined;
  const fragments = svgTextFragments(label);
  if (!fragments.length || fragments.length > 64) return undefined;
  try {
    const rect = shape as SVGRectElement;
    const matrix = rect.getScreenCTM();
    if (!matrix) return undefined;
    const transform = toDiagram.multiply(matrix);
    if (!unrotated(transform)) return undefined;
    const bounds = projectedBox(rect.getBBox(), transform);
    if (!(bounds.width > 0 && bounds.height > 0)) return undefined;
    let overflow = 0;
    for (const fragment of fragments) {
      const screen = fragment.getScreenCTM?.();
      if (!screen || !hasPlainCompositing(fragment, svg, view)) return undefined;
      const paint = view.getComputedStyle(fragment);
      if (paint.fill === 'none' || Number(paint.fillOpacity) === 0 || (paint.stroke !== 'none' && Number(paint.strokeOpacity) > 0)) return undefined;
      const onDiagram = toDiagram.multiply(screen);
      if (!unrotated(onDiagram)) return undefined;
      const text = projectedBox(fragment.getBBox(), onDiagram);
      if (!(text.width > 0 && text.height > 0)) return undefined;
      overflow = Math.max(overflow, bounds.x - text.x, bounds.y - text.y,
        text.x + text.width - bounds.x - bounds.width, text.y + text.height - bounds.y - bounds.height);
    }
    return Number.isFinite(overflow) ? overflow : undefined;
  } catch {
    return undefined;
  }
}
