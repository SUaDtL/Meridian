import type { MermaidProjectV3, SemanticRole } from './mermaid-project';

/** First measured, opt-in role shape in the original Presentation recipe. */
export function presentationRoleShape(recipe: MermaidProjectV3['design']['recipe'], role: SemanticRole | undefined) {
  return recipe?.id === 'presentation' && recipe.version === '1.0.0' && role === 'decision' ? 'diamond' as const : undefined;
}
