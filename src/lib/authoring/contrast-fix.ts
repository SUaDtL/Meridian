import { buildExportFrame } from '../export';
import type { MermaidProjectV3 } from './mermaid-project';
import type { renderMermaidProject } from './project-render';
import { minimumConnectorContrast, viewingScale, type ViewingProfile } from './readability';
import { readSrgbPaint, solidContrast, solidTextContrast } from './solid-text-color';
import { validateMermaidProject } from './validate-mermaid-project';

type Rendered = Awaited<ReturnType<typeof renderMermaidProject>>;
export type ContrastKind = 'text' | 'connector';

export function measureTargetContrast(rendered: Rendered, project: MermaidProjectV3, elementId: string, profile: ViewingProfile, kind: ContrastKind) {
  const target = rendered.targetTable?.targets.find(item => item.id === elementId);
  const appearance = rendered.result.elements?.find(item => item.key === elementId
    && item.capabilities.includes(kind === 'text' ? 'text' : 'stroke'))?.appearance;
  if (kind === 'connector') {
    const paint = appearance?.solidConnectorPaint;
    if (target?.elementKind !== 'edge' || !paint) throw new Error('Meridian could not verify this connector against a solid backdrop.');
    return { kind, ratio: solidContrast(paint.stroke, paint.backing), threshold: minimumConnectorContrast, paint,
      label: target.label, svg: buildExportFrame(rendered.result, project).svg } as const;
  }
  if (!target || !appearance?.solidTextPaint || typeof appearance.labelSizeInDiagram !== 'number') {
    throw new Error('Meridian could not verify solid text and background colors for this label.');
  }
  const { svg, ...geometry } = buildExportFrame(rendered.result, project);
  const pixels = appearance.labelSizeInDiagram * viewingScale(profile, geometry);
  if (!Number.isFinite(pixels) || pixels <= 0) throw new Error('The current label size could not be measured.');
  return { kind, ...solidTextContrast(appearance.solidTextPaint, pixels), paint: appearance.solidTextPaint, pixels, label: target.label, svg } as const;
}

export function buildContrastCandidate(project: MermaidProjectV3, elementId: string, before: ReturnType<typeof measureTargetContrast>) {
  if (before.ratio >= before.threshold) throw new Error('This element already meets the measured contrast target.');
  const choices = ['#000000', '#ffffff'].map(color => {
    const paint = readSrgbPaint(color)!;
    const ratio = before.kind === 'connector' ? solidContrast(paint, before.paint.backing)
      : solidTextContrast({ ...before.paint, text: paint }, before.pixels).ratio;
    return { color, ratio };
  });
  const best = choices[0].ratio >= choices[1].ratio ? choices[0] : choices[1];
  const field = before.kind === 'connector' ? 'stroke' : 'color';
  const document = validateMermaidProject({
    ...project,
    design: { ...project.design, elements: { ...project.design.elements,
      [elementId]: { ...project.design.elements[elementId], [field]: best.color } } },
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  return { document, color: best.color };
}
