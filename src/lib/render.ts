import type { MermaidConfig } from 'mermaid';
import DOMPurify from 'dompurify';
import type { RenderNode, RenderResult, StudioSettings } from '../types';
import { getTheme } from './themes';
import type { DesignState } from '../types/design';
import { createDesign, decorateDesign, designRenderSource, edgeIdentities, measureDesignElements, type FlowModel } from './design';
import { SourceDiagnosticError } from './authoring/source-diagnostics';
import { RenderCache, renderMemoryBudget, renderMemoryLimit } from './render-cache';
import { checkRenderSignal, latestRenderQueue, renderAborted, type RenderPriority } from './render-queue';

const NS = 'http://www.w3.org/2000/svg';
const MAX_SOURCE = 100_000;
let serial = 0;
const LAYOUT_SETTINGS = ['theme', 'layout', 'curve', 'spacing', 'font'] as const;
const DECORATION_SETTINGS = ['finish', 'shadow', 'glow', 'motion', 'speed', 'edgeWidth'] as const;
const GEOMETRY_STYLES = new Set(['shape', 'font', 'fontSize', 'fontWeight', 'routing']);

function orderedEntries(value: Record<string, unknown>): Array<[string, unknown]> {
  return Object.keys(value).sort().map(key => [key, value[key]]);
}

function designEntries(design: DesignState, geometryOnly = false) {
  return Object.keys(design.elements).sort().flatMap(key => {
    const entries = orderedEntries(design.elements[key] as Record<string, unknown>)
      .filter(([property, value]) => value !== undefined && (!geometryOnly || GEOMETRY_STYLES.has(property)));
    return entries.length ? [[key, entries]] : [];
  });
}

/** Only inputs that affect the rendered diagram; framing and document metadata are separate. */
export function renderFingerprint(source: string, settings: StudioSettings, nodeAccents: Record<string, string>, design: DesignState = createDesign()): string {
  return JSON.stringify([source, LAYOUT_SETTINGS.map(key => settings[key]), DECORATION_SETTINGS.map(key => settings[key]), orderedEntries(nodeAccents), design.preset === 'infrastructure', designEntries(design)]);
}

/** Appearance-only changes reuse Mermaid's measured layout. Theme remains a native Mermaid input. */
export function layoutFingerprint(source: string, settings: StudioSettings, design: DesignState = createDesign()): string {
  return JSON.stringify([source, LAYOUT_SETTINGS.map(key => settings[key]), design.preset === 'infrastructure', designEntries(design, true)]);
}

interface LayoutSnapshot {
  id: string;
  svg: string;
  diagramType: string;
  model?: FlowModel;
  warnings: string[];
  modelBytes: number;
}

interface RenderInput {
  source: string;
  settings: StudioSettings;
  nodeAccents: Record<string, string>;
  design: DesignState;
  prepared: ReturnType<typeof prepareSource>;
  projection?: RenderDesignProjection;
}

export interface RenderDesignProjection {
  key: string;
  resolve(model: FlowModel | undefined): Promise<DesignState>;
}

const layoutCache = new RenderCache<LayoutSnapshot>(6, renderMemoryLimit, renderMemoryBudget);
const resultCache = new RenderCache<RenderResult>(8, renderMemoryLimit, renderMemoryBudget);
const resultFootprints = new WeakMap<RenderResult, { model?: FlowModel; modelBytes: number; elementBytes: number }>();
let foregroundKey: string | undefined;

/** The model is already detached from Mermaid's shared parser. Use it read-only. */
export function flowchartModelFor(result: RenderResult): FlowModel | undefined {
  return resultFootprints.get(result)?.model;
}

/** A rendering copy only. The original Mermaid text is never rewritten. */
function prepareSource(source: string): { text: string; warnings: string[] } {
  if (source.length > MAX_SOURCE) throw new Error('This diagram is too large. Keep the source at or below 100,000 characters.');
  let text = source.replace(/^\uFEFF/, '').trim();
  const warnings: string[] = [];
  if (/^```(?:mermaid)?\s*\n/i.test(text) && /\n```$/.test(text)) {
    text = text.replace(/^```(?:mermaid)?\s*\n/i, '').replace(/\n```$/, '');
  }
  // Studio owns presentation and security. Removing the complete frontmatter
  // avoids interpreting arbitrary YAML or merging untrusted Mermaid options.
  const frontmatter = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
  if (frontmatter.test(text)) {
    text = text.replace(frontmatter, '');
    warnings.push('Source frontmatter is preserved in your project; studio settings control this preview.');
  }
  if (/%%\{[\s\S]*?\}%%/.test(text)) {
    text = text.replace(/%%\{[\s\S]*?\}%%/g, '');
    warnings.push('Mermaid configuration directives are preserved in your source; studio settings control this preview.');
  }
  // These can cause a resource request during Mermaid's measurement pass,
  // before the returned SVG can be sanitized. Block them before rendering.
  if (/@\{[^}]*\b(?:img|image)\s*:/i.test(text) || /<(?:img|image|iframe|object|embed|script)\b/i.test(text) || /!\[[^\]]*\]\s*\(/.test(text)) {
    throw new SourceDiagnosticError('resource', 'Images and embedded HTML are not supported. Use text labels and built-in Mermaid shapes. Your source has been kept.');
  }
  // Decode CSS escapes for this check only, so an escaped spelling of url()
  // cannot fetch a resource in the renderer or an exported SVG.
  const resourceScan = text
    .replace(/\\([0-9a-f]{1,6})[ \t\r\n\f]?/gi, (_, hex: string) => String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)))
    .replace(/\\([^\r\n])/g, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\b(?:url|image-set|expression)\s*\(|@(?:import|font-face)\b|(?:behavior|-moz-binding)\s*:/i.test(resourceScan)) {
    throw new SourceDiagnosticError('resource', 'CSS URLs and external resources are not supported. Remove the resource reference to render this diagram.');
  }
  if (/^[ \t]*click\s+\S+.*$/m.test(text)) {
    text = text.replace(/^[ \t]*click\s+\S+.*$/gm, '');
    warnings.push('Source click actions are disabled. Select nodes on the canvas to style them.');
  }
  if (!text.trim()) throw new Error('Add some Mermaid source to draw your diagram.');
  return { text, warnings };
}

function makeElement<K extends keyof SVGElementTagNameMap>(doc: Document, name: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = doc.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
  return el;
}

function mix(first: string, second: string, ratio: number): string {
  const a = first.replace('#', '');
  const b = second.replace('#', '');
  if (a.length !== 6 || b.length !== 6) return first;
  return `#${[0, 2, 4].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - ratio) + parseInt(b.slice(i, i + 2), 16) * ratio).toString(16).padStart(2, '0')).join('')}`;
}

function numeric(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

/** Adapter for Mermaid 12's namespaced flowchart SVG IDs. */
export function flowchartSourceKey(domId: string, renderId: string): string | undefined {
  const localId = domId.startsWith(`${renderId}-`) ? domId.slice(renderId.length + 1) : domId;
  return localId.match(/^flowchart-(.+)-\d+$/)?.[1];
}

function safeSvg(raw: string): SVGSVGElement {
  const clean = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'image', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'],
    FORBID_ATTR: ['onclick', 'onload', 'onerror'],
    ADD_ATTR: ['data-id', 'data-et', 'data-edge', 'data-look'],
  });
  const parsed = new DOMParser().parseFromString(clean, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error('The diagram could not be converted to a safe SVG.');
  const svg = parsed.documentElement as unknown as SVGSVGElement;
  if (svg.localName !== 'svg') throw new Error('The renderer did not return an SVG diagram.');
  for (const el of svg.querySelectorAll('*')) {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || (/^(?:href|xlink:href)$/i.test(attr.name) && !attr.value.startsWith('#'))) el.removeAttribute(attr.name);
    }
  }
  // Native SMIL animation is replaced by studio motion; remove its now-empty
  // decoration, leaving semantic edges and optional step badges intact.
  svg.querySelectorAll('.edge-step-dot, .edge-step-highlight').forEach((el) => el.remove());
  return svg;
}

async function performRender({ settings, nodeAccents, design: inputDesign, prepared, projection }: RenderInput, signal: AbortSignal): Promise<RenderResult> {
  checkRenderSignal(signal);
  const { text } = prepared;
  const warnings = [...prepared.warnings];
  const fingerprint = layoutFingerprint(text, settings, inputDesign);
  const layoutKey = projection ? JSON.stringify([fingerprint, projection.key]) : fingerprint;
  const cachedLayout = layoutCache.get(layoutKey);
  const theme = getTheme(settings.theme);
  const id = cachedLayout?.id ?? `meridian-${++serial}`;
  const font = settings.font === 'mono' ? 'Consolas, "Liberation Mono", monospace' : 'Arial, Helvetica, sans-serif';
  const spacing = settings.spacing === 'compact' ? 30 : settings.spacing === 'airy' ? 78 : 50;
  const edgeWidth = numeric(settings.edgeWidth, 1.8, 0.5, 6);
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    htmlLabels: false,
    maxTextSize: MAX_SOURCE,
    maxEdges: 500,
    theme: 'base',
    look: 'classic',
    layout: settings.layout,
    // Only an explicitly chosen preset changes the published ELK defaults.
    elk: inputDesign.preset === 'infrastructure' ? { preset: 'default', straightenEdges: true, lineHops: 'gap', mergeEdges: false } : undefined,
    darkMode: theme.dark,
    fontFamily: font,
    deterministicIds: true,
    deterministicIDSeed: id,
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'themeCSS', 'fontFamily', 'theme', 'themeVariables', 'layout', 'look'],
    flowchart: { htmlLabels: false, useMaxWidth: false, curve: settings.curve, nodeSpacing: spacing, rankSpacing: spacing + 12, padding: 20, diagramPadding: 20, wrappingWidth: 220, minNodeWidth: 80, subGraphTitleMargin: { top: 12, bottom: 16 } },
    sequence: { useMaxWidth: false, actorMargin: spacing, boxMargin: 16, noteMargin: 16, messageMargin: 42, wrap: true },
    er: { useMaxWidth: false },
    state: { useMaxWidth: false },
    class: { useMaxWidth: false },
    themeVariables: {
      darkMode: theme.dark,
      fontFamily: font,
      fontSize: '16px',
      background: theme.canvas,
      primaryColor: theme.node,
      mainBkg: theme.node,
      primaryTextColor: theme.text,
      primaryBorderColor: theme.border,
      secondaryColor: theme.canvasRaised,
      secondaryTextColor: theme.text,
      secondaryBorderColor: theme.border,
      tertiaryColor: theme.cluster,
      tertiaryTextColor: theme.text,
      tertiaryBorderColor: theme.border,
      lineColor: theme.edge,
      textColor: theme.text,
      nodeTextColor: theme.text,
      clusterBkg: theme.cluster,
      clusterBorder: mix(theme.border, theme.canvas, 0.45),
      edgeLabelBackground: theme.canvas,
      titleColor: theme.text,
      actorBkg: theme.node,
      actorBorder: theme.border,
      actorTextColor: theme.text,
      actorLineColor: theme.border,
      signalColor: theme.edge,
      signalTextColor: theme.text,
      labelBoxBkgColor: theme.canvasRaised,
      labelBoxBorderColor: theme.border,
      labelTextColor: theme.text,
      loopTextColor: theme.text,
      noteBkgColor: theme.cluster,
      noteBorderColor: theme.border,
      noteTextColor: theme.text,
      activationBkgColor: theme.canvasRaised,
      activationBorderColor: theme.accent,
      sectionBkgColor: theme.cluster,
      altSectionBkgColor: theme.canvas,
      sectionBkgColor2: theme.canvasRaised,
      taskBkgColor: theme.node,
      taskBorderColor: theme.accent,
      taskTextColor: theme.text,
      taskTextOutsideColor: theme.text,
      activeTaskBkgColor: theme.accent,
      activeTaskBorderColor: theme.accent,
      gridColor: theme.border,
      todayLineColor: theme.accent,
      pie1: theme.accent, pie2: theme.secondary, pie3: theme.palette[2] ?? theme.edge,
      pie4: theme.palette[3] ?? theme.border,
      pieTitleTextColor: theme.text, pieSectionTextColor: theme.text, pieLegendTextColor: theme.text,
      cScale0: theme.node, cScale1: theme.canvasRaised, cScale2: theme.cluster,
      cScaleLabel0: theme.text, cScaleLabel1: theme.text, cScaleLabel2: theme.text,
      git0: theme.accent, git1: theme.secondary, git2: theme.palette[2] ?? theme.edge,
      gitBranchLabel0: theme.canvas, gitBranchLabel1: theme.canvas,
    },
  };
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-100000px;top:0;width:1600px;visibility:hidden;pointer-events:none;font-family:${font};`;
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('data-meridian-render', cachedLayout ? 'decoration' : 'layout');
  document.body.append(host);
  try {
    let model: FlowModel | undefined;
    let modelBytes = 0;
    let rendered: { diagramType: string };
    let svg: SVGSVGElement;
    let design = inputDesign;
    if (cachedLayout) {
      model = cachedLayout.model;
      modelBytes = cachedLayout.modelBytes;
      rendered = cachedLayout;
      if (projection) {
        design = await projection.resolve(model);
        checkRenderSignal(signal);
      }
      // Only this module's already-sanitized snapshots enter the layout cache.
      svg = new DOMParser().parseFromString(cachedLayout.svg, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
      warnings.push(...cachedLayout.warnings);
    } else {
      // Keep the welcome screen and source-boundary validation independent of
      // Mermaid's initialization. Normal builds also split its diagram chunks.
      const { default: mermaid } = await import('mermaid');
      checkRenderSignal(signal);
      mermaid.initialize(config);
      const diagramType = mermaid.detectType(text);
      const layoutWarnings: string[] = [];
      if (diagramType === 'mindmap') {
        // Mindmap's native radial layout is independent of graph layout choices.
        mermaid.initialize({ ...config, layout: 'cose-bilkent' });
        layoutWarnings.push('Mind maps use their native radial layout. The ELK and Dagre controls apply to graph diagrams.');
      }
      if (diagramType.startsWith('flowchart')) {
        const parsed = await mermaid.mermaidAPI.getDiagramFromText(text);
        checkRenderSignal(signal);
        const database = parsed.db as unknown as {
          getVertices: () => FlowModel['vertices'];
          getEdges: () => FlowModel['edges'] & { defaultStyle?: string[]; defaultInterpolate?: string };
          getSubGraphs: () => FlowModel['groups'];
          getDirection: () => string | undefined;
          getClasses: () => Map<string, unknown>;
        };
        // Detach source semantics before rendering the possibly styled copy.
        const edges = database.getEdges();
        model = {
          vertices: new Map(Array.from(database.getVertices(), ([key, vertex]) => [key, {
            id: vertex.id, text: vertex.text, type: vertex.type, labelType: vertex.labelType,
            styles: vertex.styles?.slice(), classes: vertex.classes?.slice(),
          }])),
          edges: edges.map(edge => ({ ...edge, style: edge.style?.slice(), classes: edge.classes?.slice() })),
          groups: database.getSubGraphs().map(group => ({ id: group.id, title: group.title, nodes: group.nodes.slice() })),
          direction: database.getDirection(),
          classCount: database.getClasses().size,
          defaultStyle: edges.defaultStyle?.slice(),
          defaultInterpolate: edges.defaultInterpolate,
        };
        modelBytes = JSON.stringify({ ...model, vertices: [...model.vertices] }).length * 2;
      }
      if (projection) {
        design = await projection.resolve(model);
        checkRenderSignal(signal);
      }
      const renderText = model ? designRenderSource(text, design, model) : text;
      const output = await mermaid.render(id, renderText, host);
      checkRenderSignal(signal);
      rendered = output;
      svg = safeSvg(output.svg);
      if (/<foreignObject\b/i.test(output.svg)) layoutWarnings.push('This diagram contains HTML-only content that is omitted for portable SVG export. Text labels and built-in shapes work best.');
      const clean = new XMLSerializer().serializeToString(svg);
      layoutCache.set(layoutKey, { id, svg: clean, diagramType: output.diagramType, model, modelBytes, warnings: layoutWarnings },
        { parts: model ? [clean, { object: model, bytes: modelBytes }] : [clean] });
      warnings.push(...layoutWarnings);
    }
    const doc = svg.ownerDocument;
    svg.setAttribute('data-meridian', 'diagram');
    svg.setAttribute('xmlns', NS);
    svg.style.removeProperty('max-width');
    svg.style.backgroundColor = 'transparent';
    svg.style.fontFamily = font;
    const defs = makeElement(doc, 'defs');
    svg.prepend(defs);

    const gradient = makeElement(doc, 'linearGradient', { id: `${id}-surface`, x1: '0%', x2: '100%', y1: '0%', y2: '100%' });
    gradient.append(makeElement(doc, 'stop', { offset: '0%', 'stop-color': theme.node }), makeElement(doc, 'stop', { offset: '100%', 'stop-color': theme.nodeEnd }));
    defs.append(gradient);
    const shadow = makeElement(doc, 'filter', { id: `${id}-depth`, x: '-45%', y: '-65%', width: '190%', height: '230%', 'color-interpolation-filters': 'sRGB' });
    if (settings.shadow) shadow.append(makeElement(doc, 'feDropShadow', { dx: 0, dy: 5, stdDeviation: 5, 'flood-color': '#000000', 'flood-opacity': theme.dark ? 0.28 : 0.11 }));
    if (settings.glow) shadow.append(makeElement(doc, 'feDropShadow', { dx: 0, dy: 0, stdDeviation: 5, 'flood-color': theme.accent, 'flood-opacity': 0.20 }));
    defs.append(shadow);
    const nodes: RenderNode[] = [];
    // Mermaid exposes stable source IDs on some renderers. Flowchart's DOM ID
    // convention is tested against the pinned package; other types fall back
    // to a noninteractive diagram rather than inventing a source ID.
    const groups = Array.from(svg.querySelectorAll<SVGGElement>('g.node, g[data-et="participant"]'));
    const seen = new Set<string>();
    for (const [groupIndex, group] of groups.entries()) {
      // v12 namespaces the generated DOM IDs with the render ID. Remove only
      // that exact prefix, never part of a user's own node identifier.
      const key = group.getAttribute('data-id') || (rendered.diagramType.startsWith('flowchart') ? flowchartSourceKey(group.id, id) : undefined);
      if (!key) continue;
      if (!group.id) group.id = `${id}-participant-${groupIndex}`;
      const labelElement = group.querySelector('.nodeLabel, .label, text');
      // Mermaid breaks wrapped SVG labels into separate rows. Preserve the word
      // boundary even when the next row's first span has no leading space.
      const rows = labelElement?.querySelectorAll('text > tspan.text-outer-tspan');
      const text = rows?.length ? Array.from(rows, row => row.textContent ?? '').join(' ') : labelElement?.textContent;
      const label = (text ?? key).replace(/\s+/g, ' ').trim();
      group.setAttribute('data-node-key', key);
      group.setAttribute('tabindex', '0');
      group.setAttribute('role', 'button');
      group.setAttribute('aria-label', `Style ${label}`);
      group.style.cursor = 'pointer';
      if (settings.shadow || settings.glow) group.style.filter = `url(#${id}-depth)`;
      const rawAccent = nodeAccents[key];
      const normalizedAccent = /^#[0-9a-f]{3}$/i.test(rawAccent ?? '')
        ? `#${rawAccent.slice(1).split('').map((digit) => digit + digit).join('')}`
        : rawAccent;
      const accent = /^#[0-9a-f]{6}$/i.test(normalizedAccent ?? '') ? normalizedAccent : undefined;
      let fillId = `${id}-surface`;
      if (accent) {
        fillId = `${id}-node-${groupIndex}`;
        const accentGradient = makeElement(doc, 'linearGradient', { id: fillId, x1: '0%', x2: '100%', y1: '0%', y2: '100%' });
        accentGradient.append(makeElement(doc, 'stop', { offset: '0%', 'stop-color': mix(theme.node, accent, theme.dark ? 0.22 : 0.12) }), makeElement(doc, 'stop', { offset: '100%', 'stop-color': mix(theme.nodeEnd, accent, theme.dark ? 0.08 : 0.04) }));
        defs.append(accentGradient);
      }
      const shapes = group.querySelectorAll<SVGElement>([
        ':scope > rect', ':scope > circle', ':scope > ellipse', ':scope > polygon', ':scope > path',
        ':scope > g.label-container > path', ':scope > g.label-container > rect', ':scope > g.label-container > circle', ':scope > g.label-container > ellipse', ':scope > g.label-container > polygon',
        ':scope > g > path.node-bkg',
      ].join(', '));
      for (const shape of shapes) {
        if (shape.getAttribute('fill') === 'none' || shape.style.fill === 'none') continue;
        if (!shape.style.stroke) shape.style.stroke = mix(theme.border, theme.accent, 0.18);
        if (rendered.diagramType.startsWith('flowchart') && design.elements[`node:${key}`]?.shape !== 'rect' && shape.localName === 'rect' && (!shape.hasAttribute('rx') || shape.getAttribute('rx') === '0')) {
          shape.setAttribute('rx', '8'); shape.setAttribute('ry', '8');
        }
        if (accent) {
          shape.style.setProperty('stroke', accent, 'important');
          shape.style.setProperty('fill', settings.finish === 'gradient' ? `url(#${fillId})` : mix(theme.node, accent, 0.16), 'important');
        } else if (settings.finish === 'gradient' && !shape.style.fill) {
          // Authored classDef !important rules still win over this decoration.
          shape.style.fill = `url(#${fillId})`;
        }
      }
      if (!seen.has(key)) nodes.push({ id: group.id, key, label: label || key });
      seen.add(key);
    }
    for (const rect of svg.querySelectorAll<SVGRectElement>('.cluster > rect')) {
      if (!rect.getAttribute('rx')) { rect.setAttribute('rx', '12'); rect.setAttribute('ry', '12'); }
    }
    const edges = Array.from(svg.querySelectorAll<SVGPathElement>('path[data-et="edge"], path.flowchart-link'));
    const uniqueEdges = Array.from(new Set(edges));
    for (const edge of uniqueEdges) {
      if (!edge.style.strokeWidth) edge.style.strokeWidth = `${edgeWidth}px`;
    }
    const duration = 4 / numeric(settings.speed, 1, 0.25, 3);
    if (settings.motion !== 'none') {
      let motionEdges = uniqueEdges;
      if (uniqueEdges.length > 150 && model) {
        const keys = edgeIdentities(model.edges);
        const highlighted = new Set(model.edges.flatMap((edge, index) =>
          edge.id && design.elements[keys[index]]?.emphasis === 'highlight' ? [edge.id] : []));
        const priority = (edge: SVGPathElement) => highlighted.has(edge.getAttribute('data-id') ?? edge.id.replace(id + '-', ''));
        if (highlighted.size) motionEdges = [...uniqueEdges.filter(priority), ...uniqueEdges.filter(edge => !priority(edge))];
      }
      motionEdges.slice(0, 150).forEach((edge, index) => {
        if (!edge.getAttribute('d') || edge.style.stroke === 'transparent' || edge.style.strokeWidth === '0px') return;
        const pulse = makeElement(doc, 'path', {
          d: edge.getAttribute('d')!,
          class: 'meridian-motion',
          'data-studio-motion': 'true',
          'data-edge-native-id': edge.getAttribute('data-id') ?? edge.id,
          'aria-hidden': 'true',
          fill: 'none',
          stroke: theme.accent,
          'stroke-width': edgeWidth + (settings.motion === 'pulse' ? 0.7 : 0.3),
          'stroke-linecap': 'round',
          pathLength: 100,
          'stroke-dasharray': settings.motion === 'pulse' ? '12 88' : '2 23',
          'pointer-events': 'none',
        });
        if (edge.hasAttribute('transform')) pulse.setAttribute('transform', edge.getAttribute('transform')!);
        pulse.style.animation = `${id}-travel ${duration}s linear infinite`;
        pulse.style.animationDelay = `${-index * 0.37}s`;
        pulse.style.opacity = settings.motion === 'pulse' ? '0.8' : '0.95';
        edge.after(pulse);
      });
      if (uniqueEdges.length === 0) warnings.push('Flow effects apply to path-based connectors. This diagram keeps its native layout and theme.');
      if (uniqueEdges.length > 150) warnings.push('Up to 150 connectors animate. Highlight a connector to give it priority, or choose specific paths in a scene.');
    }
    const elements = decorateDesign(svg, id, nodes, model, design, settings);
    const css = makeElement(doc, 'style');
    css.setAttribute('data-meridian-style', 'true');
    css.textContent = `
      #${id} { font-family: ${font}; }
      #${id} [data-node-key] { transition: opacity .18s ease, filter .18s ease; }
      #${id} .cluster-label text { font-size: 14px; font-weight: 600; letter-spacing: .3px; }
      #${id} .edgeLabel text { font-size: 13px; }
      #${id} .meridian-motion { pointer-events: none; }
      ${settings.motion === 'none' ? `#${id} * { animation: none !important; }` : ''}
      @keyframes ${id}-travel { to { stroke-dashoffset: -100; } }
      @media (prefers-reduced-motion: reduce) {
        #${id} *, #${id} { animation: none !important; transition: none !important; }
        #${id} .meridian-motion { display: none !important; }
      }
    `;
    svg.append(css);
    let viewBox = (svg.getAttribute('viewBox') ?? '').trim().split(/[ ,]+/).map(Number);
    if (viewBox.length !== 4 || viewBox.some((n) => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0) {
      const w = parseFloat(svg.getAttribute('width') ?? '') || 800;
      const h = parseFloat(svg.getAttribute('height') ?? '') || 500;
      viewBox = [0, 0, w, h];
    }
    // Filters extend beyond shape geometry, so retain breathing room in export.
    const hasElementEffects = Object.values(design.elements).some(style => style.shadow || style.glow || style.emphasis === 'highlight');
    const bleed = hasElementEffects ? 24 : settings.shadow || settings.glow ? 18 : 6;
    const width = viewBox[2] + bleed * 2;
    const height = viewBox[3] + bleed * 2;
    svg.setAttribute('viewBox', `${viewBox[0] - bleed} ${viewBox[1] - bleed} ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    host.replaceChildren(svg);
    // Measure authored visibility without inheriting the offscreen host's hidden state.
    host.style.visibility = 'visible';
    measureDesignElements(svg, elements, settings);
    const otherEdges = svg.querySelectorAll('[data-et="message"], .relationshipLine, .messageLine0, .messageLine1').length;
    const result = { svg: new XMLSerializer().serializeToString(svg), diagramType: rendered.diagramType, nodes, elements, edgeCount: uniqueEdges.length || otherEdges, width, height, warnings };
    resultFootprints.set(result, { model, modelBytes, elementBytes: JSON.stringify(elements).length * 2 });
    return result;
  } finally {
    host.remove();
  }
}

function prioritizeForeground(key: string) {
  if (foregroundKey && foregroundKey !== key) resultCache.prioritize(foregroundKey, 'optional');
  foregroundKey = key;
  resultCache.prioritize(key, 'foreground');
}

const renderQueue = latestRenderQueue(performRender);

export async function renderDiagram(source: string, settings: StudioSettings, nodeAccents: Record<string, string>, design: DesignState = createDesign(), options: { signal?: AbortSignal; projection?: RenderDesignProjection; priority?: RenderPriority } = {}): Promise<RenderResult> {
  if (options.signal?.aborted) throw renderAborted();
  // Validate synchronously before scheduling, lazy-loading Mermaid, or reading
  // a cache. A rejected source must never touch the rendering DOM.
  const prepared = prepareSource(source);
  const fingerprint = renderFingerprint(source, settings, nodeAccents, design);
  const key = options.projection ? JSON.stringify([fingerprint, options.projection.key]) : fingerprint;
  const cached = resultCache.get(key);
  const foreground = options.priority !== 'preview';
  if (cached) {
    renderQueue.cancel(options.priority);
    if (foreground) prioritizeForeground(key);
    return cached;
  }
  const result = await renderQueue.submit(key, { source, settings, nodeAccents, design, prepared, projection: options.projection }, options.signal, options.priority);
  if (foreground) prioritizeForeground(key);
  const footprint = resultFootprints.get(result);
  if (footprint && resultCache.get(key) !== result) {
    const { model, modelBytes, elementBytes } = footprint;
    const parts = model ? [result.svg, { object: model, bytes: modelBytes }] : [result.svg];
    resultCache.set(key, result, { parts, privateBytes: elementBytes }, foreground ? 'foreground' : 'optional');
  }
  return result;
}
