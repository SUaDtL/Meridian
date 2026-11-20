import { buildExportFrame } from '../export';
import type { MermaidProjectV3 } from './mermaid-project';
import type { renderMermaidProject } from './project-render';
import { viewingScale, type ViewingProfile } from './readability';
import { readSrgbPaint, solidTextContrast } from './solid-text-color';
import { validateMermaidProject } from './validate-mermaid-project';

type Rendered = Awaited<ReturnType<typeof renderMermaidProject>>;

export function measureTargetContrast(rendered: Rendered, project: MermaidProjectV3, elementId: string, profile: ViewingProfile) {
  const target = rendered.targetTable?.targets.find(item => item.id === elementId);
  const appearance = rendered.result.elements?.find(item => item.key === elementId && item.capabilities.includes('text'))?.appearance;
  if (!target || !appearance?.solidTextPaint || typeof appearance.labelSizeInDiagram !== 'number') {
    throw new Error('Meridian could not verify solid text and background colors for this label.');
  }
  const { svg, ...geometry } = buildExportFrame(rendered.result, project);
  const pixels = appearance.labelSizeInDiagram * viewingScale(profile, geometry);
  if (!Number.isFinite(pixels) || pixels <= 0) throw new Error('The current label size could not be measured.');
  return { ...solidTextContrast(appearance.solidTextPaint, pixels), paint: appearance.solidTextPaint, pixels, label: target.label, svg };
}

export function buildContrastCandidate(project: MermaidProjectV3, elementId: string, before: ReturnType<typeof measureTargetContrast>) {
  if (before.ratio >= before.threshold) throw new Error('This label already meets the contrast target for the current viewing profile.');
  const choices = ['#000000', '#ffffff'].map(color => ({
    color, ...solidTextContrast({ ...before.paint, text: readSrgbPaint(color)! }, before.pixels),
  }));
  const best = choices[0].ratio >= choices[1].ratio ? choices[0] : choices[1];
  const document = validateMermaidProject({
    ...project,
    design: { ...project.design, elements: { ...project.design.elements,
      [elementId]: { ...project.design.elements[elementId], color: best.color } } },
    revision: project.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  return { document, color: best.color };
}
