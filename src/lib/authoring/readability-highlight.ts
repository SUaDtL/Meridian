import { buildExportFrame } from '../export';
import type { MermaidProjectV3 } from './mermaid-project';
import type { renderMermaidProject } from './project-render';

/** Mark previously measured bounds in a static review image. */
export function buildReadabilityHighlight(
  frame: Awaited<ReturnType<typeof renderMermaidProject>>, project: MermaidProjectV3, selected: readonly string[], focus = false,
) {
  const ids = new Set(selected);
  const targets = frame.targetTable?.targets.filter(target => ids.has(target.id));
  if (!targets?.length || ids.size !== targets.length) throw new Error('The reviewed targets are unavailable in the current diagram.');

  const exported = buildExportFrame(frame.result, project);
  const doc = new DOMParser().parseFromString(exported.svg, 'image/svg+xml');
  const diagram = [...doc.documentElement.children].find(child => child.localName === 'svg');
  if (!diagram) throw new Error('The diagram preview could not be displayed.');
  if (focus) {
    const bounds = targets.map(target => target.bounds);
    const left = Math.min(...bounds.map(item => item.x));
    const top = Math.min(...bounds.map(item => item.y));
    const right = Math.max(...bounds.map(item => item.x + item.width));
    const bottom = Math.max(...bounds.map(item => item.y + item.height));
    const viewBox = diagram.getAttribute('viewBox')?.trim().split(/[ ,]+/u).map(Number);
    if (viewBox?.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) {
      throw new Error('The accepted diagram did not provide a viewing area.');
    }
    const width = Math.max(right - left + 48, viewBox[2] / 4);
    const height = Math.max(bottom - top + 48, viewBox[3] / 4);
    diagram.setAttribute('viewBox', [(left + right - width) / 2, (top + bottom - height) / 2, width, height].join(' '));
    (diagram as SVGSVGElement).style.overflow = 'hidden';
  }
  const ns = 'http://www.w3.org/2000/svg';
  const overlay = doc.createElementNS(ns, 'g');
  overlay.setAttribute('fill', 'none');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('pointer-events', 'none');
  for (const { bounds } of targets) {
    const marker = doc.createElementNS(ns, 'rect');
    const padding = 4;
    for (const [name, value] of Object.entries({
      x: bounds.x - padding, y: bounds.y - padding, width: bounds.width + 2 * padding,
      height: bounds.height + 2 * padding, rx: padding,
    })) marker.setAttribute(name, String(value));
    marker.setAttribute('vector-effect', 'non-scaling-stroke');
    marker.setAttribute('stroke', '#18181b');
    marker.setAttribute('stroke-width', '4');
    const emphasis = marker.cloneNode() as SVGRectElement;
    emphasis.setAttribute('stroke', '#fde047');
    emphasis.setAttribute('stroke-width', '2');
    emphasis.setAttribute('stroke-dasharray', '5 3');
    overlay.append(marker, emphasis);
  }
  diagram.append(overlay);
  return new XMLSerializer().serializeToString(doc.documentElement);
}
