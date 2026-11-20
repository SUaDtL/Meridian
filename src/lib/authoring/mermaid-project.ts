import type { StudioSettings } from '../../types';
import type { DesignPresetId, ElementStyle } from '../../types/design';
import type { StoryScene } from '../../types/storyboard';
import type { IdentityRecord } from './identities';

export type SemanticRole =
  | 'process' | 'decision' | 'service' | 'database' | 'queue' | 'external' | 'person' | 'boundary' | 'neutral';

export interface OrphanSceneReference {
  sceneId: string;
  field: 'visible' | 'highlight' | 'flow' | 'camera';
  index: number;
}

export interface OrphanAnnotation {
  id: string;
  formerElementId: string | null;
  legacyKey: string;
  reason: 'missing' | 'ambiguous' | 'retired' | 'unsupported';
  retained: {
    style?: ElementStyle;
    role?: SemanticRole;
    sceneReferences?: OrphanSceneReference[];
    componentIds?: string[];
  };
}

interface RecipeReference {
  id: string;
  version: string;
}

export interface MermaidProjectV3 {
  schema: 'meridian/v3';
  documentKind: 'mermaid';
  id: string;
  revision: number;
  title: string;
  subtitle: string;
  updatedAt: string;
  source: string;
  settings: StudioSettings;
  design: {
    preset: DesignPresetId;
    elements: Record<string, ElementStyle>;
    recipe: RecipeReference | null;
    applyRoleShapes: boolean;
    recipeElements: Record<string, { recipe: RecipeReference; style: ElementStyle }>;
  };
  identity: { version: 1; elements: readonly IdentityRecord[]; orphans: OrphanAnnotation[] };
  roles: { elementId: string; role: SemanticRole }[];
  storyboard: { version: 2; scenes: StoryScene[]; loop: boolean };
  componentInstances: {
    id: string;
    definitionId: string;
    definitionVersion: string;
    definitionHash: string;
    bindings: { localId: string; elementId: string }[];
  }[];
  provenance: {
    elementId: string;
    adapter: string;
    adapterVersion: string;
    virtualPath: string;
    pointer: string;
    relationship: string;
  }[];
}
