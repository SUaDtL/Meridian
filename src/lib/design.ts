import type { DiagramTheme, RenderNode, StudioDocument, StudioSettings } from '../types';
import type { DesignPresetId, DesignState, ElementCapability, ElementStyle, RenderElement } from '../types/design';
import { DEFAULT_SETTINGS, getTheme } from './themes';

const NS = 'http://www.w3.org/2000/svg';
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const SHAPES = ['rect', 'rounded', 'stadium', 'diamond', 'circle', 'cylinder', 'hexagon'] as const;
const FONTS = { sans: 'Arial', mono: 'monospace', serif: 'Georgia' } as const;
const CHOICES = {
  lineStyle: ['solid', 'dashed', 'dotted'], font: ['sans', 'mono', 'serif'],
  fontWeight: ['normal', 'bold'], shape: SHAPES, emphasis: ['normal', 'muted', 'highlight'],
  routing: ['smooth', 'direct', 'orthogonal'], arrowhead: ['source', 'none', 'arrow', 'both', 'circle', 'diamond'],
} as const;
const COLORS = ['fill', 'color', 'stroke'];
const BOOLEANS = ['shadow', 'glow'];

export interface DesignPreset {
  id: Exclude<DesignPresetId, 'custom'>;
  name: string;
  description: string;
  settings: Partial<StudioSettings>;
}

export const DESIGN_PRESETS: DesignPreset[] = [
  { id: 'executive', name: 'Executive', description: 'Quiet contrast and generous space for the room.', settings: { theme: 'porcelain', layout: 'dagre', spacing: 'airy', curve: 'basis', finish: 'solid', shadow: true, glow: false, motion: 'none', background: 'none', ambient: false, font: 'sans', edgeWidth: 1.6, frame: '16:9', padding: 64 } },
  { id: 'infrastructure', name: 'Infrastructure', description: 'Layered systems with clear, orthogonal routes.', settings: { theme: 'obsidian', layout: 'elk', spacing: 'balanced', curve: 'step', finish: 'gradient', shadow: true, glow: false, motion: 'flow', background: 'dots', ambient: false, font: 'sans', edgeWidth: 1.8, frame: 'auto', padding: 48 } },
  { id: 'cyberpunk', name: 'Cyberpunk', description: 'Violet surfaces, luminous edges, measured motion.', settings: { theme: 'dusk', layout: 'dagre', spacing: 'airy', curve: 'basis', finish: 'gradient', shadow: true, glow: true, motion: 'pulse', background: 'grid', ambient: true, font: 'mono', edgeWidth: 2.2, frame: '16:9', padding: 56 } },
  { id: 'minimal', name: 'Minimal', description: 'Clean ink, flat surfaces, nothing competing for attention.', settings: { theme: 'porcelain', layout: 'dagre', spacing: 'balanced', curve: 'linear', finish: 'solid', shadow: false, glow: false, motion: 'none', background: 'none', ambient: false, font: 'sans', edgeWidth: 1.2, frame: 'auto', padding: 40 } },
  { id: 'technical-blueprint', name: 'Technical Blueprint', description: 'Precise geometry and a technical cyan palette.', settings: { theme: 'blueprint', layout: 'dagre', spacing: 'airy', curve: 'step', finish: 'solid', shadow: false, glow: false, motion: 'none', background: 'grid', ambient: false, font: 'mono', edgeWidth: 1.4, frame: 'auto', padding: 48 } },
];

export function createDesign(): DesignState { return { preset: 'custom', elements: {} }; }

export function applyDesignPreset(doc: Pick<StudioDocument, 'design'>, id: DesignPresetId): { settings: StudioSettings; design: DesignState } {
  const preset = DESIGN_PRESETS.find(item => item.id === id);
  return { settings: { ...DEFAULT_SETTINGS, ...preset?.settings }, design: { preset: preset?.id ?? 'custom', elements: { ...doc.design?.elements } } };
}

/** Only bounded, declarative values are admitted; imported projects cannot inject CSS. */
export function validateDesign(value: unknown): DesignState {
  if (value === undefined) return createDesign();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Design must be an object.');
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some(key => !['preset', 'elements'].includes(key))) throw new Error('Design contains an unsupported field.');
  if (typeof raw.preset !== 'string' || !['custom', ...DESIGN_PRESETS.map(p => p.id)].includes(raw.preset)) throw new Error('Design preset is not supported.');
  if (!raw.elements || typeof raw.elements !== 'object' || Array.isArray(raw.elements)) throw new Error('Design elements must be an object.');
  const entries = Object.entries(raw.elements);
  if (entries.length > 2_000) throw new Error('A project can contain at most 2,000 element styles.');
  const elements: Record<string, ElementStyle> = Object.create(null) as Record<string, ElementStyle>;
  for (const [key, item] of entries) {
    if (FORBIDDEN.has(key) || !/^(?:node|edge|group):/.test(key) || key.length > 1000 || /[\u0000-\u001f]/.test(key)) throw new Error('Design contains an invalid element ID.');
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Element style must be an object.');
    const clean: Record<string, unknown> = {};
    for (const [property, setting] of Object.entries(item)) {
      if (COLORS.includes(property)) {
        if (typeof setting !== 'string' || !/^#[0-9a-f]{6}$/i.test(setting)) throw new Error('Element colors must contain six hexadecimal digits.');
      } else if (BOOLEANS.includes(property)) {
        if (typeof setting !== 'boolean') throw new Error('Element effects must be true or false.');
      } else if (property === 'strokeWidth' || property === 'fontSize') {
        const [min, max] = property === 'strokeWidth' ? [.5, 6] : [10, 40];
        if (typeof setting !== 'number' || !Number.isFinite(setting) || setting < min || setting > max) throw new Error(`${property} must be between ${min} and ${max}.`);
      } else if (Object.hasOwn(CHOICES, property)) {
        if (typeof setting !== 'string' || !(CHOICES[property as keyof typeof CHOICES] as readonly string[]).includes(setting)) throw new Error(`Unsupported ${property} value.`);
      } else throw new Error(`Element style contains an unsupported field: ${property}.`);
      clean[property] = setting;
    }
    elements[key] = clean as ElementStyle;
  }
  return { preset: raw.preset as DesignPresetId, elements };
}

export interface FlowEdgeModel { id?: string; isUserDefinedId?: boolean; start: string; end: string; text?: string; style?: string[]; }
export interface FlowModel {
  vertices: Map<string, { id: string; text?: string; styles?: string[] }>;
  edges: FlowEdgeModel[];
  groups: Array<{ id: string; title?: string; nodes: string[] }>;
}

/** Hash only the label, keeping endpoint identity inspectable and keys bounded. */
function labelHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

export function edgeIdentities(edges: FlowEdgeModel[]): string[] {
  const occurrences = new Map<string, number>();
  return edges.map(edge => {
    if (edge.isUserDefinedId && edge.id) return `edge:id:${encodeURIComponent(edge.id)}`;
    const base = `${encodeURIComponent(edge.start)}:${encodeURIComponent(edge.end)}:${labelHash(edge.text ?? '')}`;
    const ordinal = occurrences.get(base) ?? 0;
    occurrences.set(base, ordinal + 1);
    return `edge:${base}:${ordinal}`;
  });
}

function typography(style: ElementStyle): string[] {
  const entries: string[] = [];
  if (style.font) entries.push(`font-family:${FONTS[style.font]}`);
  if (style.fontSize !== undefined) entries.push(`font-size:${style.fontSize}px`);
  if (style.fontWeight) entries.push(`font-weight:${style.fontWeight}`);
  return entries;
}

/** Shape and font overrides are measured by Mermaid before its layout pass. */
export function designRenderSource(source: string, design: DesignState, model: FlowModel): string {
  const commands: string[] = [];
  const safeId = (id: string) => /^[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff-]*$/.test(id);
  const groupIds = new Set(model.groups.map(group => group.id));
  for (const [key, style] of Object.entries(design.elements)) {
    if (key.startsWith('node:')) {
      const id = key.slice(5);
      if (!model.vertices.has(id) || !safeId(id) || groupIds.has(id)) continue;
      if (style.shape) commands.push(`${id}@{ shape: ${style.shape === 'rounded' ? 'rounded' : style.shape} }`);
      const declarations = typography(style);
      if (declarations.length) {
        const keys = new Set(declarations.map(value => value.split(':')[0]));
        const merged = [...(model.vertices.get(id)?.styles ?? []).filter(value => !keys.has(value.split(':')[0].trim())), ...declarations];
        commands.push(`style ${id} ${merged.join(',')}`);
      }
    } else if (key.startsWith('group:')) {
      const id = key.slice(6);
      if (!groupIds.has(id) || !safeId(id)) continue;
      const declarations = typography(style);
      if (declarations.length) commands.push(`style ${id} ${declarations.join(',')}`);
    }
  }
  const identities = edgeIdentities(model.edges);
  model.edges.forEach((edge, index) => {
    const style = design.elements[identities[index]];
    if (!style) return;
    const declarations = typography(style);
    const curve = style.routing ? ({ smooth: 'basis', direct: 'linear', orthogonal: 'step' } as const)[style.routing] : undefined;
    if (declarations.length) {
      // linkStyle replaces its style array; retain source declarations that are not overridden.
      const keys = new Set(declarations.map(value => value.split(':')[0]));
      const merged = [...(edge.style ?? []).filter(value => !keys.has(value.split(':')[0].trim())), ...declarations];
      commands.push(`linkStyle ${index}${curve ? ` interpolate ${curve}` : ''} ${merged.join(',')}`);
    } else if (curve) commands.push(`linkStyle ${index} interpolate ${curve}`);
  });
  return commands.length ? `${source}\n%% Meridian preview-only design overrides\n${commands.join('\n')}\n` : source;
}

function element<K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, String(value)));
  return node;
}

function setProperty(elements: Iterable<SVGElement>, property: string, value: string): void {
  for (const node of elements) node.style.setProperty(property, value, 'important');
}

function decorate(svg: SVGSVGElement, target: SVGElement, item: RenderElement, style: ElementStyle | undefined, settings: StudioSettings, theme: DiagramTheme, index: number): void {
  target.setAttribute('data-element-key', item.key);
  target.setAttribute('data-element-kind', item.kind);
  target.setAttribute('role', 'button'); target.setAttribute('tabindex', '0');
  target.setAttribute('aria-label', `Select ${item.kind} ${item.label}`);
  target.style.cursor = 'pointer';
  if (!style) return;
  const shapes = item.kind === 'edge' ? [target] : Array.from(target.querySelectorAll<SVGElement>(item.kind === 'group' ? ':scope > rect, :scope > path' : ':scope > rect, :scope > circle, :scope > ellipse, :scope > polygon, :scope > path, :scope > g.label-container > path, :scope > g.label-container > rect, :scope > g > path.node-bkg'));
  const texts = Array.from(target.querySelectorAll<SVGElement>('text, tspan, .nodeLabel, .label, .cluster-label'));
  if (style.fill && item.kind !== 'edge') setProperty(shapes, 'fill', style.fill);
  if (style.stroke) setProperty(shapes, 'stroke', style.stroke);
  if (style.strokeWidth !== undefined) setProperty(shapes, 'stroke-width', `${style.strokeWidth}px`);
  if (style.lineStyle) setProperty(shapes, 'stroke-dasharray', style.lineStyle === 'solid' ? 'none' : style.lineStyle === 'dashed' ? '7 5' : '2 4');
  if (style.color) { setProperty(texts, 'fill', style.color); setProperty(texts, 'color', style.color); }
  if (style.font) setProperty(texts, 'font-family', FONTS[style.font]);
  if (style.fontSize !== undefined) setProperty(texts, 'font-size', `${style.fontSize}px`);
  if (style.fontWeight) setProperty(texts, 'font-weight', style.fontWeight);
  if (style.emphasis) target.setAttribute('data-design-emphasis', style.emphasis);
  if (style.emphasis === 'muted') target.style.opacity = '.38';
  if (style.emphasis === 'highlight') setProperty(shapes, 'stroke-width', `${Math.max(2.4, style.strokeWidth ?? settings.edgeWidth)}px`);
  if (style.shadow !== undefined || style.glow !== undefined || style.emphasis === 'highlight') {
    const id = `${svg.id}-element-effect-${index}`;
    const shadow = style.shadow ?? settings.shadow;
    const glow = style.glow ?? (style.emphasis === 'highlight' || settings.glow);
    const filter = element(svg.ownerDocument, 'filter', { id, x: '-60%', y: '-80%', width: '220%', height: '260%', 'color-interpolation-filters': 'sRGB' });
    if (shadow) filter.append(element(svg.ownerDocument, 'feDropShadow', { dx: 0, dy: 4, stdDeviation: 4, 'flood-color': '#000000', 'flood-opacity': theme.dark ? .35 : .15 }));
    if (glow) filter.append(element(svg.ownerDocument, 'feDropShadow', { dx: 0, dy: 0, stdDeviation: 5, 'flood-color': style.stroke ?? theme.accent, 'flood-opacity': .45 }));
    svg.querySelector('defs')?.append(filter);
    target.style.filter = shadow || glow ? `url(#${id})` : 'none';
  }
  if (item.kind === 'edge') applyArrowheads(svg, target, style, theme, index);
}

function applyArrowheads(svg: SVGSVGElement, edge: SVGElement, style: ElementStyle, theme: DiagramTheme, index: number): void {
  const color = style.stroke ?? theme.edge;
  const kind = style.arrowhead;
  if (kind && kind !== 'source') {
    edge.removeAttribute('marker-start'); edge.removeAttribute('marker-end');
    if (kind === 'none') return;
    const id = `${svg.id}-arrow-${index}`;
    const marker = element(svg.ownerDocument, 'marker', { id, viewBox: '0 0 12 12', refX: 10, refY: 6, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse', markerUnits: 'strokeWidth' });
    const shape = kind === 'circle'
      ? element(svg.ownerDocument, 'circle', { cx: 6, cy: 6, r: 4, fill: color, stroke: color })
      : element(svg.ownerDocument, 'path', { d: kind === 'diamond' ? 'M1,6 L6,1 L11,6 L6,11 Z' : 'M1,1 L11,6 L1,11 Z', fill: color, stroke: color });
    marker.append(shape); svg.querySelector('defs')?.append(marker);
    edge.setAttribute('marker-end', `url(#${id})`);
    if (kind === 'both') edge.setAttribute('marker-start', `url(#${id})`);
  } else if (style.stroke) {
    for (const position of ['marker-start', 'marker-end']) {
      const id = edge.getAttribute(position)?.match(/#([^)]*)\)/)?.[1];
      const original = id ? svg.ownerDocument.getElementById(id) : null;
      if (!original) continue;
      const copy = original.cloneNode(true) as SVGElement;
      copy.id = `${svg.id}-recolor-${index}-${position}`;
      setProperty(copy.querySelectorAll<SVGElement>('path, circle, polygon'), 'stroke', color);
      setProperty(copy.querySelectorAll<SVGElement>('path, circle, polygon'), 'fill', color);
      svg.querySelector('defs')?.append(copy);
      edge.setAttribute(position, `url(#${copy.id})`);
    }
  }
}

/** Expose source identities and apply only explicitly chosen visual overrides. */
export function decorateDesign(svg: SVGSVGElement, renderId: string, nodes: RenderNode[], model: FlowModel | undefined, design: DesignState, settings: StudioSettings): RenderElement[] {
  const theme = getTheme(settings.theme);
  const result: RenderElement[] = [];
  const add = (target: SVGElement, item: RenderElement) => {
    decorate(svg, target, item, design.elements[item.key], settings, theme, result.length);
    result.push(item);
  };
  const nodeGroups = Array.from(svg.querySelectorAll<SVGGElement>('[data-node-key]'));
  for (const node of nodes) {
    const target = nodeGroups.find(group => group.getAttribute('data-node-key') === node.key);
    if (!target) continue;
    const supportsGeometry = !!model && /^[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff-]*$/.test(node.key);
    const capabilities: ElementCapability[] = ['fill', 'text', 'stroke', 'effects'];
    if (supportsGeometry) capabilities.push('typography', 'shape');
    add(target, { key: `node:${node.key}`, kind: 'node', sourceId: node.key, label: node.label, capabilities });
  }
  if (model) {
    const groupIds = new Set(model.groups.map(group => group.id));
    for (const group of model.groups) {
      const target = Array.from(svg.querySelectorAll<SVGGElement>('g.cluster')).find(item => item.id === group.id || item.id === `${renderId}-${group.id}` || item.getAttribute('data-id') === group.id);
      if (!target) continue;
      // Mermaid cluster groups contain only the boundary and label; nodes sit
      // in sibling/nested layout groups. Scope styling to this boundary group.
      const members = group.nodes.map(id => `${groupIds.has(id) ? 'group' : 'node'}:${id}`);
      const capabilities: ElementCapability[] = ['fill', 'text', 'stroke', 'effects'];
      if (/^[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff-]*$/.test(group.id)) capabilities.push('typography');
      add(target, { key: `group:${group.id}`, kind: 'group', sourceId: group.id, label: group.title ?? group.id, members, capabilities });
      for (const member of members) { const entry = result.find(item => item.key === member); if (entry) entry.parentKey = `group:${group.id}`; }
    }
    const identities = edgeIdentities(model.edges);
    const edgePaths = Array.from(svg.querySelectorAll<SVGPathElement>('path[data-et="edge"], path.flowchart-link'));
    model.edges.forEach((edge, index) => {
      const nativeId = edge.id ?? '';
      const target = edgePaths.find(path => path.id === nativeId || path.id === `${renderId}-${nativeId}` || path.getAttribute('data-id') === nativeId);
      if (!target) return;
      const key = identities[index];
      const capabilities: ElementCapability[] = ['stroke', 'text', 'effects', 'typography', 'arrowhead'];
      if (settings.layout === 'dagre') capabilities.push('routing');
      const sourceLabel = model.vertices.get(edge.start)?.text ?? edge.start;
      const targetLabel = model.vertices.get(edge.end)?.text ?? edge.end;
      add(target, { key, kind: 'edge', sourceId: nativeId, label: edge.text ? `${sourceLabel} → ${targetLabel} · ${edge.text}` : `${sourceLabel} → ${targetLabel}`, capabilities, from: `${groupIds.has(edge.start) ? 'group' : 'node'}:${edge.start}`, to: `${groupIds.has(edge.end) ? 'group' : 'node'}:${edge.end}` });
      // Generous transparent hit area makes thin connectors operable by touch.
      const hit = target.cloneNode(false) as SVGPathElement;
      hit.removeAttribute('id'); hit.removeAttribute('data-element-key'); hit.removeAttribute('data-node-key');
      hit.removeAttribute('marker-start'); hit.removeAttribute('marker-end'); hit.removeAttribute('tabindex'); hit.removeAttribute('role'); hit.removeAttribute('aria-label');
      hit.setAttribute('data-element-owner', key); hit.setAttribute('data-edge-hit', 'true'); hit.setAttribute('aria-hidden', 'true'); hit.setAttribute('class', 'meridian-edge-hit');
      hit.style.cssText = 'fill:none!important;stroke:transparent!important;stroke-width:14px!important;pointer-events:stroke;cursor:pointer;filter:none!important;';
      target.after(hit);
      const motion = target.parentElement?.querySelectorAll<SVGElement>('[data-studio-motion]') ?? [];
      for (const pulse of motion) if (pulse.getAttribute('data-edge-native-id') === nativeId || pulse.getAttribute('data-edge-native-id') === `${renderId}-${nativeId}`) {
        pulse.setAttribute('data-element-owner', key);
        const style = design.elements[key];
        if (style?.emphasis === 'muted') pulse.style.opacity = '.2';
        if (style?.strokeWidth !== undefined) pulse.style.strokeWidth = `${style.strokeWidth + .3}px`;
      }
      const labelGroups = Array.from(svg.querySelectorAll<SVGElement>('g.edgeLabel'));
      for (const label of labelGroups) {
        const owns = label.getAttribute('data-id') === nativeId || label.id === nativeId || label.id === `${renderId}-${nativeId}` || !!Array.from(label.querySelectorAll('[data-id], [id]')).find(child => child.getAttribute('data-id') === nativeId || child.id === nativeId);
        if (!owns) continue;
        label.setAttribute('data-element-owner', key);
        const style = design.elements[key];
        label.style.cursor = 'pointer';
        const texts = label.querySelectorAll<SVGElement>('text,tspan');
        if (style?.color) { setProperty(texts, 'fill', style.color); setProperty(texts, 'color', style.color); }
        if (style?.font) setProperty(texts, 'font-family', FONTS[style.font]);
        if (style?.fontSize !== undefined) setProperty(texts, 'font-size', `${style.fontSize}px`);
        if (style?.fontWeight) setProperty(texts, 'font-weight', style.fontWeight);
        if (style?.emphasis === 'muted') label.style.opacity = '.38';
      }
    });
  }
  for (const group of result.filter(item => item.kind === 'group')) {
    for (const member of group.members ?? []) { const child = result.find(item => item.key === member); if (child) child.parentKey = group.key; }
  }
  return result;
}

/** Capture bounds in the diagram's own coordinate system while it is mounted. */
export function measureDesignElements(svg: SVGSVGElement, elements: RenderElement[]): void {
  const rootMatrix = svg.getScreenCTM();
  if (!rootMatrix) return;
  const inverse = rootMatrix.inverse();
  const targets = Array.from(svg.querySelectorAll<SVGGraphicsElement>('[data-element-key]'));
  for (const item of elements) {
    const target = targets.find(node => node.getAttribute('data-element-key') === item.key);
    if (!target) continue;
    try {
      const box = target.getBBox(), matrix = target.getScreenCTM();
      if (!matrix) continue;
      const transform = inverse.multiply(matrix);
      const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
      const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
      item.bounds = { x, y, width: Math.max(...corners.map(point => point.x)) - x, height: Math.max(...corners.map(point => point.y)) - y };
    } catch { /* Native diagram elements without geometry simply cannot be camera targets. */ }
  }
}

export function suggestedLayout(elements: RenderElement[]): Partial<StudioSettings> {
  const nodes = elements.filter(item => item.kind === 'node').length;
  const groups = elements.filter(item => item.kind === 'group').length;
  return groups > 0 || nodes > 12
    ? { layout: 'elk', spacing: 'balanced', curve: 'step' }
    : { layout: 'dagre', spacing: nodes > 7 ? 'balanced' : 'airy', curve: 'basis' };
}
