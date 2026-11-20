import type { StoryboardController, StoryboardPlayerOptions, StoryboardState, StoryScene } from '../types/storyboard';
import type { RenderElement } from '../types/design';

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export function createEmptyStoryboard(): StoryboardState {
  return { version: 1, scenes: [], loop: false };
}

export function createScene(index = 0, previous?: StoryScene): StoryScene {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `scene-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id, title: `Scene ${index + 1}`, duration: 5, transition: 0.7,
    easing: 'ease-in-out', visible: previous?.visible ? [...previous.visible] : null,
    reveal: 'together', highlight: [], flow: [],
    camera: { mode: 'fit', keys: [], padding: 56 },
  };
}

export function duplicateScene(scene: StoryScene): StoryScene {
  return {
    ...scene, id: createScene().id, title: `${scene.title.slice(0, 110)} copy`,
    visible: scene.visible === null ? null : [...scene.visible],
    highlight: [...scene.highlight], flow: [...scene.flow], camera: { ...scene.camera, keys: [...scene.camera.keys] },
  };
}

export function sceneStartTime(storyboard: StoryboardState, index: number): number {
  return storyboard.scenes.slice(0, Math.max(0, index)).reduce((sum, scene) => sum + scene.duration, 0);
}

export function storyboardDuration(storyboard: StoryboardState): number {
  return sceneStartTime(storyboard, storyboard.scenes.length);
}

/** Selecting a group includes nested members and connections wholly inside it. */
export function expandStorySelection(key: string, elements: RenderElement[]): string[] {
  const byKey = new Map(elements.map(element => [element.key, element]));
  const keys = new Set<string>();
  const visit = (target: string) => {
    const element = byKey.get(target);
    if (!element || keys.has(target)) return;
    keys.add(target);
    element.members?.forEach(visit);
  };
  visit(key);
  if (byKey.get(key)?.kind === 'group') {
    for (const element of elements) if (element.kind === 'edge' && element.from && element.to && keys.has(element.from) && keys.has(element.to)) keys.add(element.key);
  }
  return [...keys];
}

/** The sidecar has a deliberately small, strict JSON schema. No HTML, CSS or script fields. */
export function validateStoryboard(value: unknown): StoryboardState {
  if (value === undefined) return createEmptyStoryboard();
  const object = (candidate: unknown, allowed: string[], label: string): Record<string, unknown> => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error(`${label} must be an object.`);
    for (const key of Object.keys(candidate)) if (FORBIDDEN.has(key) || !allowed.includes(key)) throw new Error(`${label} contains an unsupported field: ${key}.`);
    return candidate as Record<string, unknown>;
  };
  const numeric = (candidate: unknown, min: number, max: number, label: string): number => {
    if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < min || candidate > max) throw new Error(`${label} must be between ${min} and ${max}.`);
    return candidate;
  };
  const text = (candidate: unknown, max: number, label: string): string => {
    if (typeof candidate !== 'string' || candidate.length > max) throw new Error(`${label} must be text no longer than ${max} characters.`);
    return candidate;
  };
  const keys = (candidate: unknown, label: string): string[] => {
    if (!Array.isArray(candidate) || candidate.length > 1500) throw new Error(`${label} must be a list of at most 1,500 elements.`);
    const values = candidate.map(item => {
      const key = text(item, 1000, label);
      if (!/^(node|edge|group):.+$/.test(key) || /[\u0000-\u001f]/.test(key)) throw new Error(`${label} contains an invalid diagram element.`);
      return key;
    });
    if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate elements.`);
    return values;
  };
  const s = object(value, ['version', 'scenes', 'loop'], 'Storyboard');
  if (s.version !== 1) throw new Error('This storyboard version is not supported.');
  if (typeof s.loop !== 'boolean') throw new Error('Storyboard loop must be true or false.');
  if (!Array.isArray(s.scenes) || s.scenes.length > 50) throw new Error('A storyboard can contain at most 50 scenes.');
  const scenes: StoryScene[] = s.scenes.map((candidate, index) => {
    const label = `Scene ${index + 1}`;
    const scene = object(candidate, ['id', 'title', 'duration', 'transition', 'easing', 'visible', 'reveal', 'highlight', 'flow', 'camera'], label);
    const id = text(scene.id, 120, `${label} ID`);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`${label} has an invalid ID.`);
    const duration = numeric(scene.duration, 0.5, 120, `${label} duration`);
    const transition = numeric(scene.transition, 0, Math.min(10, duration), `${label} transition`);
    if (typeof scene.easing !== 'string' || !['linear', 'ease-in-out', 'ease-out'].includes(scene.easing)) throw new Error(`${label} has an unsupported easing.`);
    if (typeof scene.reveal !== 'string' || !['together', 'sequence'].includes(scene.reveal)) throw new Error(`${label} has an unsupported reveal order.`);
    const camera = object(scene.camera, ['mode', 'keys', 'padding'], `${label} camera`);
    if (camera.mode !== 'fit' && camera.mode !== 'elements') throw new Error(`${label} camera has an unsupported mode.`);
    const flow = keys(scene.flow, `${label} flow`);
    if (flow.some(key => !key.startsWith('edge:'))) throw new Error(`${label} flow must refer to connectors.`);
    return {
      id, title: text(scene.title, 120, `${label} title`), duration, transition,
      easing: scene.easing as StoryScene['easing'], reveal: scene.reveal as StoryScene['reveal'],
      visible: scene.visible === null ? null : keys(scene.visible, `${label} visible elements`),
      highlight: keys(scene.highlight, `${label} highlights`), flow,
      camera: { mode: camera.mode, keys: keys(camera.keys, `${label} camera targets`), padding: numeric(camera.padding, 8, 240, `${label} camera padding`) },
    };
  });
  if (new Set(scenes.map(scene => scene.id)).size !== scenes.length) throw new Error('Storyboard scene IDs must be unique.');
  return { version: 1, scenes, loop: s.loop };
}

/**
 * One playback engine for the studio and exported HTML. Keep this function
 * self-contained: exportPresentation serializes its compiled function body.
 * It never changes source, document data, or the stage's pan/zoom transform.
 */
export function createStoryboardPlayer(root: SVGSVGElement, storyboard: StoryboardState, options: StoryboardPlayerOptions = {}): StoryboardController {
  const namespace = 'http://www.w3.org/2000/svg';
  const scenes = storyboard.scenes;
  const starts: number[] = [];
  let duration = 0;
  for (const scene of scenes) { starts.push(duration); duration += scene.duration; }
  let time = Math.max(0, Math.min(duration, options.initialTime || 0));
  let playing = false;
  let destroyed = false;
  let reduced = options.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  let frame = 0;
  let resizeObserver: ResizeObserver | null = null;
  let lastFrame = 0;
  let lastReported = -Infinity;
  const originalViewBox = root.getAttribute('viewBox');
  const baseBox = (originalViewBox || `0 0 ${root.getAttribute('width') || 900} ${root.getAttribute('height') || 600}`).trim().split(/[ ,]+/).map(Number);
  const fullBox = baseBox.length === 4 && baseBox.every(Number.isFinite) && baseBox[2] > 0 && baseBox[3] > 0 ? baseBox : [0, 0, 900, 600];
  const previousStory = root.getAttribute('data-story-playing');
  const targets = Array.from(root.querySelectorAll<SVGGraphicsElement>('[data-element-key], [data-element-owner]')).map(element => ({
    element, key: element.getAttribute('data-element-key') || element.getAttribute('data-element-owner') || '',
    style: element.getAttribute('style'), aria: element.getAttribute('aria-hidden'), tabIndex: element.getAttribute('tabindex'),
    opacity: Number.isFinite(Number.parseFloat(getComputedStyle(element).opacity)) ? Number.parseFloat(getComputedStyle(element).opacity) : 1,
  }));
  const baseMotion = Array.from(root.querySelectorAll<SVGElement>('[data-studio-motion]')).map(element => ({ element, style: element.getAttribute('style') }));
  for (const item of baseMotion) item.element.style.setProperty('display', 'none', 'important');
  const flowPaths: Array<{ key: string; path: SVGPathElement }> = [];
  const edgeSeen = new Set<string>();
  for (const item of targets) {
    if (!item.key.startsWith('edge:') || edgeSeen.has(item.key)) continue;
    const edge = item.element.localName === 'path' ? item.element as SVGPathElement : item.element.querySelector<SVGPathElement>('path:not([data-studio-motion])');
    if (!edge?.getAttribute('d')) continue;
    edgeSeen.add(item.key);
    const path = document.createElementNS(namespace, 'path');
    path.setAttribute('d', edge.getAttribute('d')!);
    if (edge.hasAttribute('transform')) path.setAttribute('transform', edge.getAttribute('transform')!);
    path.setAttribute('data-story-flow', item.key);
    path.setAttribute('aria-hidden', 'true');
    path.setAttribute('fill', 'none');
    path.setAttribute('pathLength', '100');
    path.setAttribute('stroke-dasharray', '4 16');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('pointer-events', 'none');
    const edgeStyle = getComputedStyle(edge);
    const accent = /^#[0-9a-f]{3,8}$/i.test(options.accent || '') ? options.accent! : '#8fe0c2';
    path.style.setProperty('stroke', accent, 'important');
    path.style.setProperty('stroke-width', `${Math.max(2.8, (Number.parseFloat(edgeStyle.strokeWidth) || 1.8) + 1.4)}px`, 'important');
    path.style.setProperty('fill', 'none', 'important');
    path.style.setProperty('display', 'none');
    edge.after(path);
    flowPaths.push({ key: item.key, path });
  }
  const ease = (value: number, kind: string) => {
    const n = Math.max(0, Math.min(1, value));
    return kind === 'linear' ? n : kind === 'ease-out' ? 1 - Math.pow(1 - n, 3) : n < 0.5 ? 4 * n * n * n : 1 - Math.pow(-2 * n + 2, 3) / 2;
  };
  const sceneIndexAt = () => {
    if (!scenes.length) return -1;
    for (let index = scenes.length - 1; index >= 0; index--) if (time >= starts[index]) return index;
    return 0;
  };
  const getState = () => ({ time, duration, sceneIndex: sceneIndexAt(), playing });
  const report = (force = false) => {
    const now = performance.now();
    if (force || now - lastReported >= 80) { lastReported = now; options.onUpdate?.(getState()); }
  };
  const nodeByKey = new Map<string, SVGGraphicsElement>();
  for (const item of targets) if (item.element.hasAttribute('data-element-key') && !nodeByKey.has(item.key)) nodeByKey.set(item.key, item.element);
  // Capture geometry once, while the original framing is in place. Coordinates
  // are converted through screen matrices to handle nested SVGs and clusters.
  const bounds = new Map<string, number[]>();
  const measureBounds = () => {
    try {
      const inverse = root.getScreenCTM()?.inverse();
      if (inverse) for (const [key, element] of nodeByKey) {
        try {
          const box = element.getBBox();
          const matrix = element.getScreenCTM();
          if (!matrix || (!box.width && !box.height)) continue;
          const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => {
            const point = root.createSVGPoint(); point.x = x; point.y = y;
            return point.matrixTransform(matrix).matrixTransform(inverse);
          });
          const left = Math.min(...points.map(point => point.x));
          const top = Math.min(...points.map(point => point.y));
          const measured = [left, top, Math.max(...points.map(point => point.x)) - left, Math.max(...points.map(point => point.y)) - top];
          if (measured.every(Number.isFinite)) bounds.set(key, measured);
        } catch { /* Unsupported SVG geometry falls back to the full diagram. */ }
      }
    } catch { /* A hidden canvas is measured again when its panel becomes visible. */ }
  };
  measureBounds();
  const cameraFor = (scene: typeof scenes[number] | undefined): number[] => {
    if (!scene || scene.camera.mode !== 'elements') return fullBox;
    const boxes = scene.camera.keys.map(key => bounds.get(key)).filter((box): box is number[] => Boolean(box));
    if (!boxes.length) return fullBox;
    const pad = scene.camera.padding;
    let left = Math.min(...boxes.map(box => box[0])) - pad;
    let top = Math.min(...boxes.map(box => box[1])) - pad;
    let width = Math.max(...boxes.map(box => box[0] + box[2])) + pad - left;
    let height = Math.max(...boxes.map(box => box[1] + box[3])) + pad - top;
    const aspect = fullBox[2] / fullBox[3];
    if (width / height < aspect) { const target = height * aspect; left -= (target - width) / 2; width = target; }
    else { const target = width / aspect; top -= (target - height) / 2; height = target; }
    return [left, top, Math.max(40, width), Math.max(40, height)];
  };
  let cameraBoxes = scenes.map(cameraFor);
  const paint = () => {
    const index = sceneIndexAt();
    const scene = scenes[index];
    if (!scene) return;
    const elapsed = Math.max(0, time - starts[index]);
    const visible = scene.visible === null ? null : new Set(scene.visible);
    const previous = scenes[index - 1];
    const before = previous?.visible === null ? null : new Set(previous?.visible || []);
    const highlight = new Set(scene.highlight);
    const revealKeys = scene.visible === null ? Array.from(nodeByKey.keys()) : scene.visible;
    const entering = revealKeys.filter(key => index === 0 || (before !== null && !before.has(key)));
    const step = scene.reveal === 'sequence' && entering.length > 1 ? Math.min(scene.transition || 0.35, Math.max(0, (scene.duration - scene.transition) / entering.length)) : 0;
    const alphaByKey = new Map<string, number>();
    for (const item of targets) {
      const shown = visible === null || visible.has(item.key);
      let alpha = shown ? 1 : 0;
      if (shown && !reduced && scene.transition > 0) {
        const enteringIndex = entering.indexOf(item.key);
        if (enteringIndex >= 0 && (index > 0 || scene.reveal === 'sequence')) {
          // The first visible item anchors an opening scene immediately.
          const delay = Math.max(0, enteringIndex) * step;
          alpha = index === 0 && enteringIndex === 0 ? 1 : ease((elapsed - delay) / scene.transition, scene.easing);
        }
      }
      if (shown && highlight.size && !highlight.has(item.key)) alpha *= 0.26;
      item.element.style.setProperty('opacity', String(alpha * item.opacity), 'important');
      item.element.style.setProperty('transition', 'none', 'important');
      item.element.style.setProperty('animation-play-state', playing && !reduced ? 'running' : 'paused', 'important');
      item.element.style.setProperty('pointer-events', shown ? 'auto' : 'none', 'important');
      item.element.setAttribute('aria-hidden', String(!shown));
      if (item.element.hasAttribute('data-element-key')) item.element.setAttribute('tabindex', '-1');
      alphaByKey.set(item.key, alpha);
    }
    const activeFlow = new Set(scene.flow);
    for (const { key, path } of flowPaths) {
      const alpha = alphaByKey.get(key) ?? (visible === null || visible.has(key) ? 1 : 0);
      path.style.setProperty('display', !reduced && activeFlow.has(key) && alpha > 0 ? '' : 'none');
      path.style.setProperty('opacity', String(alpha));
      path.setAttribute('stroke-dashoffset', String(-(elapsed * 26) % 100));
    }
    const destination = cameraBoxes[index] || fullBox;
    const origin = cameraBoxes[index - 1] || fullBox;
    const fraction = reduced || scene.transition <= 0 ? 1 : ease(elapsed / scene.transition, scene.easing);
    root.setAttribute('viewBox', destination.map((value, offset) => origin[offset] + (value - origin[offset]) * fraction).join(' '));
    root.setAttribute('data-story-scene', scene.id);
    root.setAttribute('data-story-playing', String(playing));
  };
  const tick = (timestamp: number) => {
    if (destroyed || !playing) return;
    if (lastFrame) time = Math.min(duration, time + Math.max(0, Math.min(0.25, (timestamp - lastFrame) / 1000)));
    lastFrame = timestamp;
    if (time >= duration) {
      if (storyboard.loop && duration > 0) { time = 0; lastFrame = timestamp; }
      else playing = false;
    }
    paint(); report(!playing);
    if (playing) frame = requestAnimationFrame(tick);
  };
  const pause = () => { if (destroyed) return; playing = false; cancelAnimationFrame(frame); lastFrame = 0; paint(); report(true); };
  const seek = (seconds: number) => {
    if (destroyed) return;
    time = Math.max(0, Math.min(duration, Number.isFinite(seconds) ? seconds : 0));
    lastFrame = 0; paint(); report(true);
  };
  const play = () => {
    if (destroyed || playing || !scenes.length) return;
    if (time >= duration) time = 0;
    playing = true; lastFrame = 0; paint(); report(true); frame = requestAnimationFrame(tick);
  };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true; playing = false; cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    for (const item of targets) {
      if (item.style === null) item.element.removeAttribute('style'); else item.element.setAttribute('style', item.style);
      if (item.aria === null) item.element.removeAttribute('aria-hidden'); else item.element.setAttribute('aria-hidden', item.aria);
      if (item.tabIndex === null) item.element.removeAttribute('tabindex'); else item.element.setAttribute('tabindex', item.tabIndex);
    }
    for (const item of baseMotion) if (item.style === null) item.element.removeAttribute('style'); else item.element.setAttribute('style', item.style);
    for (const item of flowPaths) item.path.remove();
    if (originalViewBox === null) root.removeAttribute('viewBox'); else root.setAttribute('viewBox', originalViewBox);
    root.removeAttribute('data-story-scene');
    if (previousStory === null) root.removeAttribute('data-story-playing'); else root.setAttribute('data-story-playing', previousStory);
  };
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      if (destroyed) return;
      measureBounds(); cameraBoxes = scenes.map(cameraFor); paint();
    });
    resizeObserver.observe(root);
  }
  paint(); report(true);
  return {
    play, pause, seek, destroy, getState,
    previous: () => { const index = sceneIndexAt(); seek(starts[Math.max(0, index - 1)] || 0); },
    next: () => { const index = sceneIndexAt(); seek(starts[Math.min(scenes.length - 1, index + 1)] ?? duration); },
    restart: () => { seek(0); play(); },
    setReducedMotion: (value: boolean) => { if (destroyed) return; reduced = value; paint(); report(true); },
  };
}
