import type { StudioSettings } from '../../types';
import type { ElementCapability, ElementStyle } from '../../types/design';
import type { MermaidProjectV3, SemanticRole } from './mermaid-project';
import { presentationRoleShape } from './presentation-role-shape';
import { verifiedTopology, type renderMermaidProject } from './project-render';
import { groupedFlowchartTopology } from './source-patches';
import { validateMermaidProject } from './validate-mermaid-project';

type PaintField = 'fill' | 'color' | 'stroke';
type StyleField = PaintField | 'fontSize';
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
const presentationLabelSize = 22;

export function readDesignRecipe(id: DesignRecipeId) {
  if (!Object.hasOwn(definitions, id)) throw new Error('Choose one of the available design recipes.');
  const { title, description, settings, nodeStyle } = definitions[id];
  return { id, version: recipeVersion, title, description, settings: { ...settings }, nodeStyle: { ...nodeStyle },
    scopedLabelSize: id === 'presentation' ? presentationLabelSize : null,
    decisionShape: presentationRoleShape({ id, version: recipeVersion }, 'decision') ?? null };
}

const display: Record<keyof RecipeSettings, string> = {
  spacing: 'Spacing', frame: 'Frame', padding: 'Padding', motion: 'Motion', background: 'Background', ambient: 'Ambient light', shadow: 'Shadows',
};

type ScopedDesign = ({ kind: 'selection'; ids: readonly string[] } | { kind: 'role'; role: SemanticRole }) & { preserveOverrides?: boolean; enlargeLabels?: boolean };
export type DesignScope = { kind: 'diagram'; applyRoleShapes?: boolean } | ScopedDesign;
type Frame = Awaited<ReturnType<typeof renderMermaidProject>>;
type RecipeChange = { label: string; before: unknown; after: unknown };
type ScopeSummary = { eligible: number; total: number; protectedFields: number; clearedFields: number; clearedTargets: number;
  exclusions: string[]; omitted: string[]; typography?: { protected: string[]; moved: string[] } };
type StyleProof = { targetId: string; field: StyleField; value: string | number };

const paintFields = { fill: 'Fill', color: 'Text', stroke: 'Border' } as const;
const verifiedFields = ['fill', 'color', 'stroke', 'fontSize'] as const;
const capability: Record<PaintField, ElementCapability> = { fill: 'fill', color: 'text', stroke: 'stroke' };

export function buildDesignRecipeCandidate(base: MermaidProjectV3, id: DesignRecipeId, applyRoleShapes: boolean, current?: Frame) {
  const recipe = readDesignRecipe(id);
  const changes: RecipeChange[] = (Object.keys(recipe.settings) as (keyof RecipeSettings)[]).flatMap(field => {
    const before = base.settings[field];
    const after = recipe.settings[field];
    return before === after ? [] : [{ field, label: display[field], before, after }];
  });
  const shapeIds: string[] = [];
  if (applyRoleShapes) {
    groupedFlowchartTopology(base.source);
    if (!recipe.decisionShape || !current?.targetTable) throw new Error('Choose Presentation for a verified decision shape review.');
    const roles = new Map(base.roles.map(item => [item.elementId, item.role]));
    for (const item of current.result.elements ?? []) {
      if (item.kind !== 'node' || !presentationRoleShape(recipe, roles.get(item.key)) || !item.capabilities.includes('shape')
        || base.design.elements[item.key]?.shape || base.design.recipeElements[item.key]?.style.shape) continue;
      if (item.appearance?.diamondShape === undefined) throw new Error('The renderer could not measure a decision node’s current shape.');
      shapeIds.push(item.key);
      if (!item.appearance.diamondShape) changes.push({ label: `${item.label} · Presentation shape`, before: 'Existing shape', after: 'Diamond' });
    }
    if (!shapeIds.length) throw new Error('Assign the Decision role to a current node without a shape override.');
  }
  if (applyRoleShapes !== base.design.applyRoleShapes) {
    changes.push({ label: 'Presentation role shapes', before: base.design.applyRoleShapes, after: applyRoleShapes });
  }
  const unchanged = !changes.length && base.design.recipe?.id === recipe.id && base.design.recipe.version === recipe.version;
  const document = unchanged ? base : validateMermaidProject({
    ...base,
    settings: { ...base.settings, ...recipe.settings },
    design: { ...base.design, recipe: { id: recipe.id, version: recipe.version }, applyRoleShapes },
    revision: base.revision + 1,
    updatedAt: new Date().toISOString(),
  });
  return { recipe, document, changes, scope: undefined, proof: [] as StyleProof[], shapeIds };
}

/** Scope appearance to measured nodes and clear only explicitly reviewed paint overrides. */
export function buildScopedDesignRecipe(base: MermaidProjectV3, id: DesignRecipeId, intent: ScopedDesign, frame: Frame) {
  groupedFlowchartTopology(base.source);
  if (!frame.targetTable) throw new Error('Open a verified flowchart before styling a selection.');
  const recipe = readDesignRecipe(id);
  const selected = new Set(intent.kind === 'role'
    ? base.roles.filter(item => item.role === intent.role).map(item => item.elementId) : intent.ids);
  if (!selected.size || selected.size > 1_500) throw new Error('Choose a scope with 1 to 1,500 diagram elements.');
  const elements = new Map(frame.result.elements?.map(item => [item.key, item]));
  const bound = new Map(base.identity.elements.map(item => [item.id, item.binding.sourceId]));
  const recipeElements = { ...base.design.recipeElements };
  const manualElements = { ...base.design.elements };
  const changes: RecipeChange[] = [];
  const exclusions: string[] = [];
  const proof: StyleProof[] = [];
  const labelSize = intent.enlargeLabels && recipe.scopedLabelSize;
  const protectedTypography: string[] = [];
  let eligible = 0;
  let protectedFields = 0;
  let clearedFields = 0;
  let clearedTargets = 0;

  for (const targetId of selected) {
    const element = elements.get(targetId);
    const name = element ? `${element.label || 'Unnamed element'} (${bound.get(targetId) ?? 'no source ID'})` : 'Unavailable element';
    const previous = recipeElements[targetId];
    const sameRecipe = previous?.recipe.id === recipe.id && previous.recipe.version === recipe.version;
    const unsupportedStyle = previous && Object.keys(previous.style).some(field =>
      !Object.hasOwn(paintFields, field) && !(sameRecipe && field === 'fontSize'));
    if (element?.kind !== 'node' || unsupportedStyle) {
      exclusions.push(name);
      continue;
    }
    const style: ElementStyle = { ...previous?.style };
    const manualStyle = { ...manualElements[targetId] };
    const clearedBefore = clearedFields;
    const start = proof.length;
    let hasEligiblePaint = false;
    for (const [field, label] of Object.entries(paintFields) as [PaintField, string][]) {
      const before = element.appearance?.[field];
      const measurable = Boolean(before) && element.capabilities.includes(capability[field]);
      const override = manualStyle[field] !== undefined;
      if (override && (intent.preserveOverrides !== false || !measurable)) {
        protectedFields++;
        continue;
      }
      if (!measurable) continue;
      hasEligiblePaint = true;
      const value = recipe.nodeStyle[field];
      if (!override && before === value && previous?.recipe.id === recipe.id && previous.recipe.version === recipe.version
        && previous.style[field] === value) continue;
      if (override) {
        delete manualStyle[field];
        clearedFields++;
      }
      style[field] = value;
      proof.push({ targetId, field, value });
      changes.push({ label: `${name} · ${label}${override ? ' · Clear user override' : ''}`, before, after: value });
    }
    let hasEligibleTypography = false;
    if (labelSize) {
      const before = element.appearance?.fontSize;
      if (manualStyle.fontSize !== undefined) {
        protectedTypography.push(name);
      } else if (element.capabilities.includes('typography') && before !== undefined && before < labelSize) {
        hasEligibleTypography = true;
        style.fontSize = labelSize;
        proof.push({ targetId, field: 'fontSize', value: labelSize });
        changes.push({ label: `${name} · Label size`, before: `${before} px`, after: `${labelSize} px` });
      }
    }
    if (!hasEligiblePaint && !hasEligibleTypography) {
      exclusions.push(name);
      continue;
    }
    eligible++;
    if (proof.length > start) recipeElements[targetId] = { recipe: { id: recipe.id, version: recipe.version }, style };
    if (clearedFields > clearedBefore) {
      clearedTargets++;
      if (Object.keys(manualStyle).length) manualElements[targetId] = manualStyle;
      else delete manualElements[targetId];
    }
  }
  if (!eligible) throw new Error('This scope has no eligible node styling. Choose another selection or role.');
  const scope: ScopeSummary = {
    eligible, total: selected.size, protectedFields, clearedFields, clearedTargets, exclusions, omitted: Object.values(display),
    typography: labelSize ? { protected: protectedTypography, moved: [] } : undefined,
  };
  const document = proof.length ? validateMermaidProject({
    ...base, design: { ...base.design, recipeElements, elements: manualElements }, revision: base.revision + 1, updatedAt: new Date().toISOString(),
  }) : base;
  return { recipe, document, changes, scope, proof, selectedIds: [...selected] };
}

export function verifyScopedDesign(current: Frame, preview: Frame, proof: readonly StyleProof[], selectedIds: readonly string[]) {
  if (!current.targetTable || !preview.targetTable || verifiedTopology(current.targetTable) !== verifiedTopology(preview.targetTable)) {
    throw new Error('The selected design did not preserve the diagram topology and labels.');
  }
  const changes = new Map(proof.map(item => [`${item.targetId}:${item.field}`, item.value]));
  const measured = new Map(preview.result.elements?.map(item => [item.key, item]));
  const selected = new Set(selectedIds);
  const moved: string[] = [];
  for (const item of current.result.elements ?? []) {
    const next = measured.get(item.key);
    for (const field of verifiedFields) {
      const expected = changes.get(`${item.key}:${field}`) ?? item.appearance?.[field];
      if (next?.appearance?.[field] !== expected) throw new Error('Meridian could not verify the reviewed scope and its rendered appearance.');
    }
    if (item.kind !== 'node' || selected.has(item.key) || !item.bounds || !next?.bounds) continue;
    const before = item.bounds;
    const after = next.bounds;
    const dx = after.x + after.width / 2 - (before.x + before.width / 2);
    const dy = after.y + after.height / 2 - (before.y + before.height / 2);
    if (Math.hypot(dx, dy) >= 1) moved.push(`${item.label || 'Unnamed node'} (${item.sourceId})`);
  }
  return moved;
}

export function verifyPresentationRoleShapes(current: Frame, preview: Frame, shapeIds: readonly string[]) {
  if (!current.targetTable || !preview.targetTable || verifiedTopology(current.targetTable) !== verifiedTopology(preview.targetTable)) {
    throw new Error('The presentation shapes did not preserve the diagram topology and labels.');
  }
  const expected = new Set(shapeIds);
  const measured = new Map(preview.result.elements?.map(item => [item.key, item.appearance?.diamondShape]));
  for (const id of expected) {
    if (measured.get(id) !== true) throw new Error('The renderer did not display every reviewed Decision diamond.');
  }
  for (const item of current.result.elements ?? []) {
    if (item.kind === 'node' && !expected.has(item.key) && item.appearance?.diamondShape !== measured.get(item.key)) {
      throw new Error('The renderer changed an unreviewed node shape.');
    }
  }
}
