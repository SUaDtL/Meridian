import type { ElementStyle, RenderedAppearance } from '../../types/design';
import type { MermaidProjectV3 } from './mermaid-project';
import type { renderMermaidProject } from './project-render';
import { validateMermaidProject } from './validate-mermaid-project';

export const styleFieldLabels: Record<keyof ElementStyle, string> = {
  fill: 'Fill', color: 'Text color', stroke: 'Stroke', strokeWidth: 'Stroke width', lineStyle: 'Line style',
  font: 'Font', fontSize: 'Font size', fontWeight: 'Font weight', shape: 'Shape', shadow: 'Shadow',
  glow: 'Glow', emphasis: 'Emphasis', routing: 'Routing', arrowhead: 'Arrowheads',
};

export type DesignReset = { layer: 'user'; field: keyof ElementStyle } | { layer: 'recipe' };
type Frame = Awaited<ReturnType<typeof renderMermaidProject>>;

export function designResetFields(base: MermaidProjectV3, selection: ReadonlySet<string>) {
  const fields = new Set<keyof ElementStyle>();
  let hasRecipes = false;
  for (const id of selection) {
    for (const field of Object.keys(base.design.elements[id] ?? {}) as (keyof ElementStyle)[]) fields.add(field);
    if (base.design.recipeElements[id]) hasRecipes = true;
  }
  return { fields: (Object.keys(styleFieldLabels) as (keyof ElementStyle)[]).filter(field => fields.has(field)), hasRecipes };
}

export function buildDesignReset(base: MermaidProjectV3, accepted: Frame, selection: ReadonlySet<string>, reset: DesignReset) {
  if (!accepted.targetTable || !selection.size || selection.size > 1_500) throw new Error('Select up to 1,500 verified diagram elements.');
  if (reset.layer === 'user' && !Object.hasOwn(styleFieldLabels, reset.field)) throw new Error('Choose an available style property.');
  const elements = { ...base.design.elements };
  const recipeElements = { ...base.design.recipeElements };
  const changes = accepted.result.elements?.filter(element => selection.has(element.key)).flatMap(element => {
    const id = element.key;
    const recipe = recipeElements[id];
    const manual = elements[id];
    const fields = reset.layer === 'user' ? [reset.field] : Object.keys(recipe?.style ?? {}) as (keyof ElementStyle)[];
    const layer = reset.layer === 'user' ? manual : recipe?.style;
    const properties = fields.flatMap(field => {
      const previous = layer?.[field];
      if (previous === undefined) return [];
      const retained = reset.layer === 'user' ? recipe?.style[field] : manual?.[field];
      const origin = retained === undefined ? 'Source and diagram style'
        : reset.layer === 'recipe' ? 'User override' : `Recipe ${recipe!.recipe.id} ${recipe!.recipe.version}`;
      return [{ field, previous, retained, origin }];
    });
    if (!properties.length) return [];
    if (reset.layer === 'recipe') delete recipeElements[id];
    else {
      const remaining = { ...manual };
      delete remaining[reset.field];
      if (Object.keys(remaining).length) elements[id] = remaining;
      else delete elements[id];
    }
    return [{ id, label: `${element.label || 'Unnamed element'} (${element.sourceId})`, properties }];
  }) ?? [];
  if (!changes.length) throw new Error('The selection has no saved styles for this reset.');
  const document = validateMermaidProject({ ...base, design: { ...base.design, elements, recipeElements },
    revision: base.revision + 1, updatedAt: new Date().toISOString() });
  return { document, changes };
}

const measuredField: Partial<Record<keyof ElementStyle, keyof RenderedAppearance>> = {
  fill: 'fill', color: 'color', stroke: 'stroke', strokeWidth: 'strokeWidth', lineStyle: 'lineStyle',
  font: 'fontFamily', fontSize: 'fontSize', fontWeight: 'fontWeight',
};

export function measuredResetValues(changes: ReturnType<typeof buildDesignReset>['changes'], rendered: Frame) {
  const elements = new Map(rendered.result.elements?.map(element => [element.key, element]));
  return changes.map(change => ({ ...change, properties: change.properties.map(property => {
    const key = measuredField[property.field];
    const value = key && elements.get(change.id)?.appearance?.[key];
    return { ...property, measured: typeof value === 'string' || typeof value === 'number' ? value : undefined };
  }) }));
}
