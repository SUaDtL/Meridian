export type ElementKind = 'node' | 'edge' | 'group';
export type DesignPresetId = 'custom' | 'executive' | 'infrastructure' | 'cyberpunk' | 'minimal' | 'technical-blueprint';
export type ElementCapability = 'fill' | 'text' | 'typography' | 'shape' | 'stroke' | 'effects' | 'routing' | 'arrowhead';

/** Optional values inherit the source/theme. Source text remains the authority for topology. */
export interface ElementStyle {
  fill?: string;
  color?: string;
  stroke?: string;
  strokeWidth?: number;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  font?: 'sans' | 'mono' | 'serif';
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  shape?: 'rect' | 'rounded' | 'stadium' | 'diamond' | 'circle' | 'cylinder' | 'hexagon';
  shadow?: boolean;
  glow?: boolean;
  emphasis?: 'normal' | 'muted' | 'highlight';
  routing?: 'smooth' | 'direct' | 'orthogonal';
  arrowhead?: 'source' | 'none' | 'arrow' | 'both' | 'circle' | 'diamond';
}

export interface DesignState {
  preset: DesignPresetId;
  elements: Record<string, ElementStyle>;
}

export interface RenderElement {
  /** Stable source-based identity, independent of Mermaid's per-render SVG IDs. */
  key: string;
  kind: ElementKind;
  sourceId: string;
  label: string;
  capabilities: ElementCapability[];
  /** Keys in this collection, useful for scoped presentation scenes. */
  members?: string[];
  parentKey?: string;
  from?: string;
  to?: string;
  bounds?: { x: number; y: number; width: number; height: number };
}
