import type { StudioSettings } from '../../types';
import type { MermaidProjectV3 } from './mermaid-project';
import { validateMermaidProject } from './validate-mermaid-project';

type RecipeSettings = Pick<StudioSettings, 'spacing' | 'frame' | 'padding' | 'motion' | 'background' | 'ambient' | 'shadow'>;

const definitions = {
  clear: {
    title: 'Clear', description: 'Balanced spacing and a plain, static canvas.',
    settings: { spacing: 'balanced', frame: 'auto', padding: 40, motion: 'none', background: 'none', ambient: false, shadow: false },
  },
  presentation: {
    title: 'Presentation', description: 'A widescreen frame with room around the diagram.',
    settings: { spacing: 'airy', frame: '16:9', padding: 64, motion: 'none', background: 'none', ambient: false, shadow: true },
  },
  technical: {
    title: 'Technical', description: 'Compact spacing over a regular grid.',
    settings: { spacing: 'compact', frame: 'auto', padding: 40, motion: 'none', background: 'grid', ambient: false, shadow: false },
  },
} as const satisfies Record<string, { title: string; description: string; settings: RecipeSettings }>;

export type DesignRecipeId = keyof typeof definitions;
export const designRecipeIds = Object.freeze(Object.keys(definitions) as DesignRecipeId[]);
const recipeVersion = '1.0.0';

export function readDesignRecipe(id: DesignRecipeId) {
  if (!Object.hasOwn(definitions, id)) throw new Error('Choose one of the available design recipes.');
  const { title, description, settings } = definitions[id];
  return { id, version: recipeVersion, title, description, settings: { ...settings } };
}

const display: Record<keyof RecipeSettings, string> = {
  spacing: 'Spacing', frame: 'Frame', padding: 'Padding', motion: 'Motion', background: 'Background', ambient: 'Ambient light', shadow: 'Shadows',
};

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
  return { recipe, document, changes };
}
