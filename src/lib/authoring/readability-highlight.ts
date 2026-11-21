import { buildExportFrame } from '../export';
import type { MermaidProjectV3 } from './mermaid-project';
import type { renderMermaidProject } from './project-render';

/** Mark previously measured bounds in a static review image. */
export function buildReadabilityHighlight(
  frame: Awaited<ReturnType<typeof renderMermaidProject>>, project: MermaidProjectV3, selected: readonly string[],
) {
  const ids = new Set(selected);
  const targets = frame.targetTable?.targets.filter(target => ids.has(target.id));
  if (!targets?.length || ids.size !== targets.length) throw new Error('The reviewed targets are unavailable in the current diagram.');

  const exported = buildExportFrame(frame.result, project);
  const doc = new DOMParser().parseFromString(exported.svg, 'image/svg+xml');
  const diagram = [...doc.documentElement.children].find(child => child.localName === 'svg');
  if (!diagram) throw new Error('The diagram preview could not be displayed.');
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
