import type { StudioSettings } from '../../types';
import type { ElementCapability, ElementStyle } from '../../types/design';
import type { MermaidProjectV3, SemanticRole } from './mermaid-project';
import { verifiedTopology, type renderMermaidProject } from './project-render';
import { flowchartSubsetTopology } from './source-patches';
import { validateMermaidProject } from './validate-mermaid-project';

type PaintField = 'fill' | 'color' | 'stroke';
type RecipeSettings = Pick<StudioSettings, 'spacing' | 'frame' | 'padding' | 'motion' | 'background' | 'ambient' | 'shadow'>;

const definitions = {
  clear: {
    title: 'Clear', description: 'Balanced spacing and a plain, static canvas.',
    nodeStyle: { fill: '#f1f5f9', color: '#0f172a', stroke: '#64748b' },
    settings: { spacing: 'balanced', frame: 'auto', padding: 40, motion: 'none', background: 'none', ambient: false, shadow: false },
  },
  presentation: {
    title: 'Presentation', description: 'A widescreen frame with room around the diagram.',
    nodeStyle: { fill: '#eff6ff', color: '#172554', stroke: '#2563eb' },
    settings: { spacing: 'airy', frame: '16:9', padding: 64, motion: 'none', background: 'none', ambient: false, shadow: true },
  },
  technical: {
    title: 'Technical', description: 'Compact spacing over a regular grid.',
    nodeStyle: { fill: '#13212d', color: '#e0f2fe', stroke: '#38bdf8' },
    settings: { spacing: 'compact', frame: 'auto', padding: 40, motion: 'none', background: 'grid', ambient: false, shadow: false },
  },
} as const satisfies Record<string, { title: string; description: string; settings: RecipeSettings; nodeStyle: Record<PaintField, string> }>;

export type DesignRecipeId = keyof typeof definitions;
export const designRecipeIds = Object.freeze(Object.keys(definitions) as DesignRecipeId[]);
const recipeVersion = '1.0.0';

export function readDesignRecipe(id: DesignRecipeId) {
  if (!Object.hasOwn(definitions, id)) throw new Error('Choose one of the available design recipes.');
  const { title, description, settings, nodeStyle } = definitions[id];
  return { id, version: recipeVersion, title, description, settings: { ...settings }, nodeStyle: { ...nodeStyle } };
}

const display: Record<keyof RecipeSettings, string> = {
  spacing: 'Spacing', frame: 'Frame', padding: 'Padding', motion: 'Motion', background: 'Background', ambient: 'Ambient light', shadow: 'Shadows',
};

export type DesignScope = { kind: 'diagram' } | { kind: 'selection'; ids: readonly string[] } | { kind: 'role'; role: SemanticRole };
type ScopedDesign = Exclude<DesignScope, { kind: 'diagram' }>;
type Frame = Awaited<ReturnType<typeof renderMermaidProject>>;
type RecipeChange = { label: string; before: unknown; after: unknown };
type ScopeSummary = { eligible: number; total: number; protectedFields: number; exclusions: string[]; omitted: string[] };
type PaintProof = { targetId: string; field: PaintField; value: string };

const paintFields = { fill: 'Fill', color: 'Text', stroke: 'Border' } as const;
const capability: Record<PaintField, ElementCapability> = { fill: 'fill', color: 'text', stroke: 'stroke' };

export function buildDesignRecipeCandidate(base: MermaidProjectV3, id: DesignRecipeId) {
  const recipe = readDesignRecipe(id);
  const changes = (Object.keys(recipe.settings) as (keyof RecipeSettings)[]).flatMap(field => {
    const before = base.settings[field];
    const after = recipe.settings[field];
    return before === after ? [] : [{ field, label: display[field], before, after }];
  });
  const unchanged = !changes.length && base.design.recipe?.id === recipe.id && base.design.recipe.version === recipe.version;
  const document = unchanged ? base : validateMermaidProject({
    ...base,
    settings: { ...base.settings, ...recipe.settings },
    design: { ...base.design, recipe: { id: recipe.id, version: recipe.version } },
    revision: base.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  return { recipe, document, changes, scope: undefined, proof: [] as PaintProof[] };
}

/** Scope appearance to measured flat nodes. The separate metadata layer preserves manual overrides. */
export function buildScopedDesignRecipe(base: MermaidProjectV3, id: DesignRecipeId, intent: ScopedDesign, frame: Frame) {
  flowchartSubsetTopology(base.source);
  if (!frame.targetTable) throw new Error('Open a verified flowchart before styling a selection.');
  const recipe = readDesignRecipe(id);
  const selected = new Set(intent.kind === 'role'
    ? base.roles.filter(item => item.role === intent.role).map(item => item.elementId) : intent.ids);
  if (!selected.size || selected.size > 1_500) throw new Error('Choose a scope with 1 to 1,500 diagram elements.');
  const elements = new Map(frame.result.elements?.map(item => [item.key, item]));
  const bound = new Map(base.identity.elements.map(item => [item.id, item.binding.sourceId]));
  const recipeElements = { ...base.design.recipeElements };
  const changes: RecipeChange[] = [];
  const exclusions: string[] = [];
  const proof: PaintProof[] = [];
  let eligible = 0;
  let protectedFields = 0;

  for (const targetId of selected) {
    const element = elements.get(targetId);
    const name = element ? `${element.label || 'Unnamed element'} (${bound.get(targetId) ?? 'no source ID'})` : 'Unavailable element';
    const previous = recipeElements[targetId];
    if (element?.kind !== 'node' || (previous && Object.keys(previous.style).some(field => !Object.hasOwn(paintFields, field)))) {
      exclusions.push(name);
      continue;
    }
    const style: ElementStyle = { ...previous?.style };
    const start = proof.length;
    let hasEligiblePaint = false;
    for (const [field, label] of Object.entries(paintFields) as [PaintField, string][]) {
      if (base.design.elements[targetId]?.[field] !== undefined) {
        protectedFields++;
        continue;
      }
      const before = element.appearance?.[field];
      if (!before || !element.capabilities.includes(capability[field])) continue;
      hasEligiblePaint = true;
      const value = recipe.nodeStyle[field];
      if (before === value && previous?.recipe.id === recipe.id && previous.recipe.version === recipe.version
        && previous.style[field] === value) continue;
      style[field] = value;
      proof.push({ targetId, field, value });
      changes.push({ label: `${name} · ${label}`, before, after: value });
    }
    if (!hasEligiblePaint) {
      exclusions.push(name);
      continue;
    }
    eligible++;
    if (proof.length > start) recipeElements[targetId] = { recipe: { id: recipe.id, version: recipe.version }, style };
  }
  if (!eligible) throw new Error('This scope has no eligible node paint. Choose another selection or role.');
  const scope: ScopeSummary = {
    eligible, total: selected.size, protectedFields, exclusions, omitted: Object.values(display),
  };
  const document = proof.length ? validateMermaidProject({
    ...base, design: { ...base.design, recipeElements }, revision: base.revision + 1, updatedAt: new Date().toISOString(),
  }) : base;
  return { recipe, document, changes, scope, proof };
}

export function verifyScopedDesign(current: Frame, preview: Frame, proof: readonly PaintProof[]) {
  if (!current.targetTable || !preview.targetTable || verifiedTopology(current.targetTable) !== verifiedTopology(preview.targetTable)) {
    throw new Error('The selected design did not preserve the diagram topology and labels.');
  }
  const changes = new Map(proof.map(item => [`${item.targetId}:${item.field}`, item.value]));
  const measured = new Map(preview.result.elements?.map(item => [item.key, item]));
  for (const item of current.result.elements ?? []) {
    const next = measured.get(item.key);
    for (const field of Object.keys(paintFields) as PaintField[]) {
      const expected = changes.get(`${item.key}:${field}`) ?? item.appearance?.[field];
      if (next?.appearance?.[field] !== expected) throw new Error('Meridian could not verify the reviewed scope and its rendered paint.');
    }
  }
}
