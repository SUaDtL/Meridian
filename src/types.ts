import type { DesignState, RenderElement } from './types/design';
import type { StoryboardState } from './types/storyboard';

export type ThemeId = 'obsidian' | 'porcelain' | 'blueprint' | 'ember' | 'dusk' | 'moss';

export interface DiagramTheme {
  id: ThemeId;
  name: string;
  description: string;
  dark: boolean;
  canvas: string;
  canvasRaised: string;
  node: string;
  nodeEnd: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  secondary: string;
  edge: string;
  cluster: string;
  palette: string[];
}

export interface StudioSettings {
  theme: ThemeId;
  layout: 'dagre' | 'elk';
  curve: 'basis' | 'linear' | 'step';
  spacing: 'compact' | 'balanced' | 'airy';
  finish: 'solid' | 'gradient';
  shadow: boolean;
  glow: boolean;
  motion: 'none' | 'flow' | 'pulse';
  speed: number;
  background: 'dots' | 'grid' | 'none';
  ambient: boolean;
  frame: 'auto' | '16:9' | '4:3' | '1:1';
  font: 'sans' | 'mono';
  edgeWidth: number;
  padding: number;
  showTitle: boolean;
  showBrand: boolean;
}

export interface StudioDocument {
  schema: 'meridian/v2';
  id: string;
  title: string;
  subtitle: string;
  source: string;
  settings: StudioSettings;
  nodeAccents: Record<string, string>;
  design: DesignState;
  storyboard?: StoryboardState;
  updatedAt: string;
}

export interface RenderNode {
  id: string;
  key: string;
  label: string;
}

export interface RenderResult {
  svg: string;
  diagramType: string;
  nodes: RenderNode[];
  elements?: RenderElement[];
  edgeCount: number;
  width: number;
  height: number;
  warnings: string[];
}

export interface DiagramTemplate {
  id: string;
  title: string;
  category: string;
  description: string;
  source: string;
  subtitle: string;
  theme: ThemeId;
}
