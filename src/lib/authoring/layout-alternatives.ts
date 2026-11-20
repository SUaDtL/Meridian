import type { StudioSettings } from '../../types';
import type { MermaidProjectV3 } from './mermaid-project';
import { applySourcePatches, planFlowchartDirection, type FlowchartDirection } from './source-patches';
import { validateMermaidProject } from './validate-mermaid-project';

type LayoutSettings = Pick<StudioSettings, 'layout' | 'spacing' | 'curve'>;

const definitions = {
  compact: { title: 'Compact', description: 'Closer spacing with the Dagre engine.', settings: { layout: 'dagre', spacing: 'compact', curve: 'linear' } },
  balanced: { title: 'Balanced', description: 'Balanced spacing with the ELK engine.', settings: { layout: 'elk', spacing: 'balanced', curve: 'basis' } },
  presentation: { title: 'Presentation', description: 'More room between elements with the Dagre engine.', settings: { layout: 'dagre', spacing: 'airy', curve: 'basis' } },
} as const satisfies Record<string, { title: string; description: string; settings: LayoutSettings }>;

export type LayoutAlternativeId = keyof typeof definitions;
export const layoutAlternativeIds = Object.freeze(Object.keys(definitions) as LayoutAlternativeId[]);

export function readLayoutAlternative(id: LayoutAlternativeId) {
  if (!Object.hasOwn(definitions, id)) throw new Error('Choose an available layout.');
  const option = definitions[id];
  return { id, version: 1, title: option.title, description: option.description, settings: { ...option.settings } };
}

export type LayoutIntent = { id: LayoutAlternativeId; direction: FlowchartDirection | 'keep' };

const labels: Record<keyof LayoutSettings, string> = { layout: 'Engine', spacing: 'Spacing', curve: 'Connector curve' };

export function buildLayoutCandidate(base: MermaidProjectV3, intent: LayoutIntent) {
  const option = readLayoutAlternative(intent.id);
  const changes = (Object.keys(option.settings) as (keyof LayoutSettings)[]).flatMap(field => {
    const before = base.settings[field];
    const after = option.settings[field];
    return before === after ? [] : [{ label: labels[field], before: String(before), after: String(after) }];
  });
  const patches = intent.direction === 'keep' ? [] : planFlowchartDirection(base.source, intent.direction);
  const source = applySourcePatches(base.source, patches);
  if (patches.length) changes.push({ label: 'Source direction', before: patches[0].expectedText, after: patches[0].replacement });
  const document = !changes.length ? base : validateMermaidProject({
    ...base, source, settings: { ...base.settings, ...option.settings },
    revision: base.revision + 1, updatedAt: new Date().toISOString(),
  });
  return { option, document, changes };
}
