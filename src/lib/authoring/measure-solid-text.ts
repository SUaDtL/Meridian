import type { RenderElement } from '../../types/design';
import { readSrgbPaint, type SolidTextPaint } from './solid-text-color';

type Bounds = NonNullable<RenderElement['bounds']>;
export type MeasuredSolidText = { paint: SolidTextPaint; bounds: Bounds };

export function svgTextFragments(label: SVGElement | undefined) {
  return Array.from(label?.querySelectorAll<SVGGraphicsElement>('text, tspan') ?? [])
    .filter(text => Array.from(text.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()));
}

function dropShadowOnly(filter: string, svg: SVGSVGElement) {
  if (filter === 'none') return true;
  const id = /^url\(["']?[^#)]*#([^"')]+)["']?\)$/.exec(filter)?.[1];
  const target = id ? svg.ownerDocument.getElementById(id) : null;
  return !!target && svg.contains(target) && target.localName === 'filter' && target.children.length > 0
    && Array.from(target.children).every(child => child.localName === 'feDropShadow' && !child.hasAttribute('in'));
}

export function hasPlainCompositing(element: Element, svg: SVGSVGElement, view: Window, allowShadow = true) {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const style = view.getComputedStyle(current);
    if (Number(style.opacity) !== 1 || style.visibility !== 'visible' || style.display === 'none'
      || style.mixBlendMode !== 'normal' || style.clipPath !== 'none'
      || (style.maskImage && style.maskImage !== 'none') || (style.backdropFilter && style.backdropFilter !== 'none')
      || (allowShadow ? !dropShadowOnly(style.filter, svg) : style.filter !== 'none')) return false;
    if (current === svg) return true;
  }
  return false;
}

export function projectedBox(box: DOMRect, transform: DOMMatrix): Bounds {
  const left = box.x;
  const top = box.y;
  const right = left + box.width;
  const bottom = top + box.height;
  const corners = [[left, top], [left, bottom], [right, top], [right, bottom]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
  const x = Math.min(...corners.map(point => point.x));
  const y = Math.min(...corners.map(point => point.y));
  return { x, y, width: Math.max(...corners.map(point => point.x)) - x, height: Math.max(...corners.map(point => point.y)) - y };
}

function union(bounds: Bounds[]) {
  const x = Math.min(...bounds.map(box => box.x));
  const y = Math.min(...bounds.map(box => box.y));
  return { x, y, width: Math.max(...bounds.map(box => box.x + box.width)) - x, height: Math.max(...bounds.map(box => box.y + box.height)) - y };
}

/** Measure only text with a proven single opaque rectangular backing and ordinary SVG compositing. */
export function measureSolidNodeText(svg: SVGSVGElement, shape: SVGElement | undefined, label: SVGElement | undefined, view: Window, toDiagram: DOMMatrix): MeasuredSolidText | undefined {
  if (shape?.localName !== 'rect' || !hasPlainCompositing(shape, svg, view)) return undefined;
  const backingStyle = view.getComputedStyle(shape);
  const backdrop = readSrgbPaint(backingStyle.fill);
  if (!backdrop || backdrop.opacity !== 1 || Number(backingStyle.fillOpacity) !== 1) return undefined;
  const fragments = svgTextFragments(label);
  if (!fragments.length || fragments.length > 64) return undefined;
  try {
    const rect = shape as SVGRectElement;
    const surface = rect.getBBox();
    const screen = rect.getScreenCTM();
    if (!screen || surface.width <= 0 || surface.height <= 0) return undefined;
    const toBacking = screen.inverse();
    const corner = Math.max(Number.parseFloat(backingStyle.getPropertyValue('rx')) || 0,
      Number.parseFloat(backingStyle.getPropertyValue('ry')) || 0);
    const border = backingStyle.stroke === 'none' ? 0 : (Number.parseFloat(backingStyle.strokeWidth) || 0) / 2;
    const margin = Math.max(corner, border);
    const boxes: Bounds[] = [];
    let sample: { paint: SolidTextPaint; signature: string } | undefined;
    for (const fragment of fragments) {
      const matrix = fragment.getScreenCTM?.();
      if (!matrix || !(shape.compareDocumentPosition(fragment) & Node.DOCUMENT_POSITION_FOLLOWING) || !hasPlainCompositing(fragment, svg, view)) return undefined;
      const style = view.getComputedStyle(fragment);
      const text = readSrgbPaint(style.fill);
      if (!text || (style.stroke !== 'none' && Number(style.strokeOpacity) > 0)) return undefined;
      const fontWeight = Number.parseInt(style.fontWeight, 10);
      const alpha = text.opacity * Number(style.fillOpacity);
      if (!Number.isFinite(fontWeight) || !(alpha > 0 && alpha <= 1)) return undefined;
      const glyph = fragment.getBBox();
      const overBacking = projectedBox(glyph, toBacking.multiply(matrix));
      if (!(overBacking.width > 0 && overBacking.height > 0 && overBacking.x >= surface.x + margin && overBacking.y >= surface.y + margin
        && overBacking.x + overBacking.width <= surface.x + surface.width - margin
        && overBacking.y + overBacking.height <= surface.y + surface.height - margin)) return undefined;
      const onDiagram = toDiagram.multiply(matrix);
      const relativeSize = Number.parseFloat(style.fontSize) * Math.hypot(onDiagram.c, onDiagram.d);
      if (!Number.isFinite(relativeSize) || relativeSize <= 0) return undefined;
      const signature = JSON.stringify([text.channels, alpha, fontWeight, relativeSize]);
      if (sample && sample.signature !== signature) return undefined;
      sample = { signature, paint: { backing: backdrop.channels, text: { channels: text.channels, opacity: alpha }, bold: fontWeight >= 700 } };
      boxes.push(projectedBox(glyph, onDiagram));
    }
    return sample && { paint: sample.paint, bounds: union(boxes) };
  } catch {
    return undefined;
  }
}

export function boxesOverlap(a: Bounds, b: Bounds) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
