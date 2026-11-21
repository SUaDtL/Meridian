import type { DiagramTheme, RenderNode, StudioDocument, StudioSettings } from '../types';
import type { DesignPresetId, DesignState, ElementCapability, ElementStyle, RenderElement } from '../types/design';
import { DEFAULT_SETTINGS, getTheme } from './themes';
import { boxesOverlap, measureSolidNodeText, svgTextFragments, type MeasuredSolidText } from './authoring/measure-solid-text';
import { measureLabelOverflow } from './authoring/measure-label-containment';
import { measureSolidConnectors } from './authoring/measure-solid-connector';
import { readSrgbPaint } from './authoring/solid-text-color';
import { flattenRoute, routeSegmentLimit } from './authoring/route-geometry';

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

export function applyDesignPreset(doc: Pick<StudioDocument, 'design'> & Partial<Pick<StudioDocument, 'settings'>>, id: DesignPresetId): { settings: StudioSettings; design: DesignState } {
  const preset = DESIGN_PRESETS.find(item => item.id === id);
  return { settings: { ...DEFAULT_SETTINGS, ...doc.settings, ...preset?.settings }, design: { preset: preset?.id ?? 'custom', elements: { ...doc.design?.elements } } };
}

/** The selected base can keep renderer behavior while individual settings change. */
export function matchesDesignPreset(settings: StudioSettings, id: DesignPresetId): boolean {
  const preset = DESIGN_PRESETS.find(item => item.id === id);
  return Boolean(preset && Object.entries(preset.settings).every(([key, value]) => settings[key as keyof StudioSettings] === value));
}

/** Clearing one override restores inheritance without leaving empty sidecars. */
export function patchElementStyle(design: DesignState, key: string, values: Partial<ElementStyle>): DesignState {
  const previous = design.elements[key] ?? {};
  const next = { ...previous, ...values };
  for (const property of Object.keys(next) as Array<keyof ElementStyle>) if (next[property] === undefined) delete next[property];
  if (next.arrowhead === 'source') delete next.arrowhead;
  if (next.emphasis === 'normal') delete next.emphasis;
  const keys = Object.keys(next) as Array<keyof ElementStyle>;
  if (keys.length === Object.keys(previous).length && keys.every(property => next[property] === previous[property])) return design;
  const elements = { ...design.elements };
  if (keys.length) elements[key] = next;
  else delete elements[key];
  return { ...design, elements };
}

/** Native color inputs require hex; authored CSS colors are read as computed RGB. */
export function colorToHex(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const color = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${color.slice(1).split('').map(digit => digit + digit).join('')}`.toLowerCase();
  const match = color.match(/^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i);
  if (!match || (match[4] !== undefined && Number(match[4]) < 1)) return undefined;
  return `#${match.slice(1, 4).map(channel => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')}`;
}

/** Muted palette fills retain the current theme's readable text contrast. */
export function suggestedNodeFills(theme: DiagramTheme): string[] {
  const ratio = theme.dark ? .22 : .12;
  return theme.palette.map(accent => `#${[1, 3, 5].map(index => Math.round(
    Number.parseInt(theme.node.slice(index, index + 2), 16) * (1 - ratio) + Number.parseInt(accent.slice(index, index + 2), 16) * ratio,
  ).toString(16).padStart(2, '0')).join('')}`);
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
    if (FORBIDDEN.has(key) || !/^(?:node|edge|group):.+/.test(key) || key.length > 1000 || /[\u0000-\u001f]/.test(key)) throw new Error('Design contains an invalid element ID.');
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

export interface FlowEdgeModel {
  id?: string; isUserDefinedId?: boolean; start: string; end: string; text?: string; style?: string[];
  type?: string; length?: number; stroke?: string; labelType?: string; interpolate?: string; classes?: string[];
}
export function flowEdgeDirection(edge: Pick<FlowEdgeModel, 'type' | 'stroke'>) {
  const { type, stroke } = edge;
  return !type || type === 'arrow_open' || stroke === 'invisible' ? 'none'
    : type.startsWith('double_arrow_') ? 'both' : 'forward';
}

export interface FlowModel {
  vertices: Map<string, { id: string; text?: string; styles?: string[]; type?: string; labelType?: string; classes?: string[] }>;
  edges: FlowEdgeModel[];
  groups: Array<{ id: string; title?: string; nodes: string[] }>;
  direction?: string;
  classCount?: number;
  defaultStyle?: string[];
  defaultInterpolate?: string;
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
      if (declarations.length) {
        const keys = new Set(declarations.map(value => value.split(':')[0]));
        const merged = [...(model.vertices.get(id)?.styles ?? []).filter(value => !keys.has(value.split(':')[0].trim())), ...declarations];
        commands.push(`style ${id} ${merged.join(',')}`);
      }
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

const NODE_SHAPES = [
  ':scope > rect', ':scope > circle', ':scope > ellipse', ':scope > polygon', ':scope > path',
  ':scope > g.label-container > path', ':scope > g.label-container > rect', ':scope > g.label-container > circle',
  ':scope > g.label-container > ellipse', ':scope > g.label-container > polygon', ':scope > g > path.node-bkg',
].join(', ');

function isDiamondShape(shape: SVGElement | undefined) {
  if (shape?.localName !== 'polygon') return false;
  const vertices = (shape as SVGPolygonElement).points;
  if (vertices.numberOfItems !== 4) return false;
  const points = Array.from({ length: 4 }, (_, index) => vertices.getItem(index));
  const [left, , , right] = [...points].sort((a, b) => a.x - b.x);
  const [top, , , bottom] = [...points].sort((a, b) => a.y - b.y);
  const span = Math.max(right.x - left.x, bottom.y - top.y);
  const near = (a: number, b: number) => Math.abs(a - b) <= span * 0.001;
  return Number.isFinite(span) && span > 0 && left !== top && left !== bottom && right !== top && right !== bottom
    && near(top.x, (left.x + right.x) / 2) && near(bottom.x, top.x)
    && near(left.y, (top.y + bottom.y) / 2) && near(right.y, left.y);
}

function shapesFor(target: SVGElement, kind: RenderElement['kind']): SVGElement[] {
  return kind === 'edge' ? [target] : Array.from(target.querySelectorAll<SVGElement>(kind === 'group' ? ':scope > rect, :scope > path' : NODE_SHAPES));
}

function decorate(svg: SVGSVGElement, target: SVGElement, item: RenderElement, style: ElementStyle | undefined, settings: StudioSettings, theme: DiagramTheme, index: number): void {
  target.setAttribute('data-element-key', item.key);
  target.setAttribute('data-element-kind', item.kind);
  target.setAttribute('role', 'button'); target.setAttribute('tabindex', '0');
  target.setAttribute('aria-label', `Select ${item.kind} ${item.label}`);
  target.style.cursor = 'pointer';
  if (!style) return;
  const shapes = shapesFor(target, item.kind);
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
    const shadow = style.shadow ?? (item.kind === 'node' && settings.shadow);
    const glow = style.glow ?? (style.emphasis === 'highlight' || (item.kind === 'node' && settings.glow));
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
  const nodeGroups = new Map(Array.from(svg.querySelectorAll<SVGGElement>('[data-node-key]')).map(group => [group.getAttribute('data-node-key'), group]));
  for (const node of nodes) {
    const target = nodeGroups.get(node.key);
    if (!target) continue;
    const supportsGeometry = !!model && /^[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff-]*$/.test(node.key);
    const capabilities: ElementCapability[] = ['fill', 'text', 'stroke', 'effects'];
    if (supportsGeometry) capabilities.push('typography', 'shape');
    add(target, { key: `node:${node.key}`, kind: 'node', sourceId: node.key, label: node.label, capabilities });
  }
  if (model) {
    const groupIds = new Set(model.groups.map(group => group.id));
    const nativeId = (id: string) => id.startsWith(`${renderId}-`) ? id.slice(renderId.length + 1) : id;
    const clusters = new Map<string, SVGGElement>();
    for (const cluster of svg.querySelectorAll<SVGGElement>('g.cluster')) {
      clusters.set(nativeId(cluster.id), cluster);
      const id = cluster.getAttribute('data-id'); if (id) clusters.set(id, cluster);
    }
    for (const group of model.groups) {
      const target = clusters.get(group.id);
      if (!target) continue;
      // Mermaid cluster groups contain only the boundary and label; nodes sit
      // in sibling/nested layout groups. Scope styling to this boundary group.
      const members = group.nodes.map(id => `${groupIds.has(id) ? 'group' : 'node'}:${id}`);
      const capabilities: ElementCapability[] = ['fill', 'text', 'stroke', 'effects'];
      if (/^[a-zA-Z_\u0080-\uffff][a-zA-Z0-9_\u0080-\uffff-]*$/.test(group.id)) capabilities.push('typography');
      add(target, { key: `group:${group.id}`, kind: 'group', sourceId: group.id, label: target.querySelector('.cluster-label')?.textContent?.trim() || group.title || group.id, members, capabilities });
    }
    const identities = edgeIdentities(model.edges);
    const edgePaths = new Map<string, SVGPathElement>();
    for (const path of svg.querySelectorAll<SVGPathElement>('path[data-et="edge"], path.flowchart-link')) {
      edgePaths.set(nativeId(path.id), path);
      const id = path.getAttribute('data-id'); if (id) edgePaths.set(id, path);
    }
    const labelsById = new Map<string, Set<SVGElement>>();
    for (const label of svg.querySelectorAll<SVGElement>('g.edgeLabel')) {
      for (const candidate of [label, ...label.querySelectorAll<SVGElement>('[data-id], [id]')]) {
        for (const id of [candidate.getAttribute('data-id'), candidate.id]) {
          if (!id) continue;
          const key = nativeId(id), labels = labelsById.get(key) ?? new Set<SVGElement>();
          labels.add(label); labelsById.set(key, labels);
        }
      }
    }
    const motionById = new Map<string, SVGElement[]>();
    for (const pulse of svg.querySelectorAll<SVGElement>('[data-studio-motion][data-edge-native-id]')) {
      const key = nativeId(pulse.getAttribute('data-edge-native-id')!);
      const list = motionById.get(key) ?? []; list.push(pulse); motionById.set(key, list);
    }
    const labelsByNode = new Map(nodes.map(node => [node.key, node.label]));
    model.edges.forEach((edge, index) => {
      const edgeId = edge.id ?? '';
      const target = edgePaths.get(edgeId);
      if (!target) return;
      const key = identities[index];
      const capabilities: ElementCapability[] = ['stroke', 'effects', 'arrowhead'];
      if (edge.text?.trim()) capabilities.push('text', 'typography');
      if (settings.layout === 'dagre') capabilities.push('routing');
      const labels = labelsById.get(edgeId) ?? new Set<SVGElement>();
      const sourceLabel = labelsByNode.get(edge.start) ?? model.vertices.get(edge.start)?.text ?? edge.start;
      const targetLabel = labelsByNode.get(edge.end) ?? model.vertices.get(edge.end)?.text ?? edge.end;
      const labelText = Array.from(labels).map(label => label.textContent?.trim()).find(Boolean) || edge.text;
      const direction = flowEdgeDirection(edge);
      const connector = direction === 'forward' ? '→' : direction === 'both' ? '↔' : '–';
      const endpoints = `${sourceLabel} ${connector} ${targetLabel}`;
      add(target, { key, kind: 'edge', sourceId: edgeId, label: labelText ? `${endpoints} · ${labelText}` : endpoints, capabilities, from: `${groupIds.has(edge.start) ? 'group' : 'node'}:${edge.start}`, to: `${groupIds.has(edge.end) ? 'group' : 'node'}:${edge.end}` });
      // Generous transparent hit area makes thin connectors operable by touch.
      const hit = target.cloneNode(false) as SVGPathElement;
      // This is an interaction aid owned by an edge, not another semantic edge.
      for (const attribute of ['id', 'data-element-key', 'data-element-kind', 'data-node-key', 'data-id', 'data-et', 'data-edge', 'data-look']) hit.removeAttribute(attribute);
      hit.removeAttribute('marker-start'); hit.removeAttribute('marker-end'); hit.removeAttribute('tabindex'); hit.removeAttribute('role'); hit.removeAttribute('aria-label');
      hit.setAttribute('data-element-owner', key); hit.setAttribute('data-edge-hit', 'true'); hit.setAttribute('aria-hidden', 'true'); hit.setAttribute('class', 'meridian-edge-hit');
      hit.style.cssText = 'fill:none!important;stroke:transparent!important;stroke-width:14px!important;pointer-events:stroke;cursor:pointer;filter:none!important;';
      target.after(hit);
      for (const pulse of motionById.get(edgeId) ?? []) {
        pulse.setAttribute('data-element-owner', key);
        const style = design.elements[key];
        if (style?.emphasis === 'muted') pulse.style.opacity = '.2';
        if (style?.strokeWidth !== undefined) pulse.style.strokeWidth = `${style.strokeWidth + .3}px`;
      }
      for (const label of labels) {
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
  const byKey = new Map(result.map(item => [item.key, item]));
  for (const group of result.filter(item => item.kind === 'group')) {
    for (const member of group.members ?? []) { const child = byKey.get(member); if (child) child.parentKey = group.key; }
  }
  return result;
}

function labelSizeInDiagram(label: SVGElement | undefined, view: Window, inverse: DOMMatrix): number | undefined {
  const fragments = svgTextFragments(label);
  if (!fragments.length) return undefined;
  let smallest = Infinity;
  for (const text of fragments) {
    if (text.hasAttribute('textLength') || text.closest('text[textLength]')) return undefined;
    const screen = text.getScreenCTM?.();
    if (!screen) return undefined;
    const transform = inverse.multiply(screen);
    const x = Math.hypot(transform.a, transform.b);
    const y = Math.hypot(transform.c, transform.d);
    const dot = transform.a * transform.c + transform.b * transform.d;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x <= 0 || y <= 0
      || Math.abs(x - y) > Math.max(x, y) * 1e-5 || Math.abs(dot) > x * y * 1e-5) return undefined;
    const style = view.getComputedStyle(text);
    const size = Number.parseFloat(style.fontSize) * y;
    if (style.display === 'none' || style.visibility !== 'visible' || !Number.isFinite(size) || size <= 0) return undefined;
    smallest = Math.min(size, smallest);
  }
  return smallest;
}

/** Capture bounds in the diagram's own coordinate system while it is mounted. */
export function measureDesignElements(svg: SVGSVGElement, elements: RenderElement[], settings: StudioSettings): void {
  const rootMatrix = svg.getScreenCTM();
  if (!rootMatrix) return;
  const inverse = rootMatrix.inverse();
  const view = svg.ownerDocument.defaultView;
  const targets = new Map(Array.from(svg.querySelectorAll<SVGGraphicsElement>('[data-element-key]')).map(target => [target.getAttribute('data-element-key'), target]));
  const labels = new Map<string, SVGElement>();
  const contrast = new Map<string, MeasuredSolidText>();
  const canMeasurePaint = !elements.some(item => item.kind === 'group' || (item.kind === 'edge' && item.capabilities.includes('typography')));
  const routeBudget = { remaining: routeSegmentLimit };
  for (const label of svg.querySelectorAll<SVGElement>('g.edgeLabel[data-element-owner]')) labels.set(label.getAttribute('data-element-owner')!, label);
  const positive = (value: string | undefined) => {
    const number = Number.parseFloat(value ?? '');
    return Number.isFinite(number) && number > 0 ? number : undefined;
  };
  for (const item of elements) {
    const target = targets.get(item.key);
    if (!target) continue;
    let routePath: string | null = null;
    if (view) {
      const shapes = shapesFor(target, item.kind);
      const [shape] = shapes;
      const shapeStyle = shape ? view.getComputedStyle(shape) : undefined;
      if (routeBudget.remaining && item.kind === 'edge' && target.localName === 'path' && shapeStyle?.stroke !== 'none'
        && shapeStyle?.visibility === 'visible' && shapeStyle.display !== 'none' && shapeStyle.clipPath === 'none'
        && Number(shapeStyle.strokeOpacity) > 0 && Number(shapeStyle.opacity) > 0) {
        routePath = target.getAttribute('d');
      }
      const label = item.kind === 'edge' ? labels.get(item.key) : target;
      const text = label?.querySelector<SVGElement>('text tspan') ?? label?.querySelector<SVGElement>('text');
      const textStyle = text ? view.getComputedStyle(text) : undefined;
      const fill = shapeStyle?.fill;
      const gradientId = fill?.match(/url\(["']?(?:[^#)]*)#([^"')]+)["']?\)/)?.[1];
      const gradient = gradientId ? svg.ownerDocument.getElementById(gradientId) : null;
      const stop = gradient?.querySelector('stop');
      const dash = shapeStyle?.strokeDasharray;
      item.appearance = {
        diamondShape: item.kind === 'node' && shapes.length === 1 ? isDiamondShape(shape) : undefined,
        fill: colorToHex(fill) ?? (stop ? colorToHex(view.getComputedStyle(stop).stopColor) : undefined),
        fillKind: gradientId ? 'gradient' : fill === 'none' ? 'none' : 'solid',
        color: colorToHex(textStyle?.fill),
        stroke: colorToHex(shapeStyle?.stroke),
        strokeWidth: positive(shapeStyle?.strokeWidth),
        lineStyle: !dash || dash === 'none' || dash === '0px' ? 'solid' : Number.parseFloat(dash) <= 2 ? 'dotted' : 'dashed',
        fontSize: positive(textStyle?.fontSize),
        fontFamily: textStyle?.fontFamily,
        fontWeight: textStyle?.fontWeight,
        labelSizeInDiagram: labelSizeInDiagram(label, view, inverse),
      };
      if (canMeasurePaint && item.kind === 'node' && shapes.length === 1 && item.appearance.labelSizeInDiagram !== undefined) {
        const measured = measureSolidNodeText(svg, shape, label, view, inverse);
        if (measured) contrast.set(item.key, measured);
      }
      if (item.kind === 'node' && shapes.length === 1 && item.appearance.labelSizeInDiagram !== undefined) {
        item.appearance.labelOverflowInDiagram = measureLabelOverflow(svg, shape, label, view, inverse);
      }
    }
    try {
      const box = target.getBBox(), matrix = target.getScreenCTM();
      if (!matrix) continue;
      const transform = inverse.multiply(matrix);
      if (routePath && transform.is2D !== false) item.measuredRoute = flattenRoute(routePath, transform, routeBudget);
      const corners = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(transform));
      const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
      item.bounds = { x, y, width: Math.max(...corners.map(point => point.x)) - x, height: Math.max(...corners.map(point => point.y)) - y };
    } catch { /* Native diagram elements without geometry simply cannot be camera targets. */ }
  }
  let pairs = 0;
  for (const item of elements) {
    const candidate = contrast.get(item.key);
    if (!candidate || !item.appearance) continue;
    if (elements.some(other => other !== item && (++pairs > 100_000 || !other.bounds || boxesOverlap(other.bounds, candidate.bounds)))) continue;
    item.appearance.solidTextPaint = candidate.paint;
  }
  if (view && canMeasurePaint && !settings.ambient && settings.background === 'none' && settings.motion === 'none'
    && !settings.shadow && !settings.glow && elements.some(item => item.kind === 'edge')) {
    const canvas = readSrgbPaint(getTheme(settings.theme).canvas);
    if (canvas) measureSolidConnectors(svg, elements, targets, canvas, inverse, view);
  }
}

export function suggestedLayout(elements: RenderElement[]): Partial<StudioSettings> {
  const nodes = elements.filter(item => item.kind === 'node').length;
  const groups = elements.filter(item => item.kind === 'group').length;
  return groups > 0 || nodes > 12
    ? { layout: 'elk', spacing: 'balanced', curve: 'step' }
    : { layout: 'dagre', spacing: nodes > 7 ? 'balanced' : 'airy', curve: 'basis' };
}
