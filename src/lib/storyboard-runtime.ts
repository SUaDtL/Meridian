import type { StoryboardController, StoryboardPlayerOptions, StoryboardState, StoryScene } from '../types/storyboard';

type PlayableStoryboard = Omit<StoryboardState, 'version'> & { version: 1 | 2 };

/**
 * This factory is embedded verbatim in portable HTML. All of its runtime
 * dependencies must live inside it or be browser globals. The studio and
 * exported player therefore use exactly the same scene and timing rules.
 */
export function createStoryboardRuntime() {
  function createTimeline(storyboard: PlayableStoryboard, elementKeys: readonly string[], targetTable?: StoryboardPlayerOptions['targetTable']) {
    const available = new Set(elementKeys);
    const typed = targetTable && new Map(targetTable.targets.map(target => [target.id, target]));
    let duration = 0;
    let previousVisible: Set<string> | null = new Set();
    const scenes = storyboard.scenes.map((scene, index) => {
      const start = duration;
      duration += scene.duration;
      const visible = scene.visible === null ? null : new Set(scene.visible.filter(key => !typed || available.has(key)));
      if (typed && visible) {
        for (const key of visible) {
          const parent = typed.get(key)?.parentId;
          if (parent && available.has(parent)) visible.add(parent);
        }
      }
      const enteringKeys = (visible && typed ? [...visible] : scene.visible ?? elementKeys)
        .filter(key => available.has(key) && (index === 0 || (previousVisible !== null && !previousVisible.has(key))));
      const step = scene.reveal === 'sequence' && enteringKeys.length > 1
        ? Math.min(scene.transition || 0.35, Math.max(0, (scene.duration - scene.transition) / (enteringKeys.length - 1))) : 0;
      const entering = new Map(enteringKeys.map((key, order) => [key, { delay: order * step, anchor: index === 0 && order === 0 }]));
      previousVisible = visible;
      const flow = new Set(scene.flow.filter(key => {
        if (!typed) return true;
        const edge = typed.get(key);
        return available.has(key) && edge?.elementKind === 'edge' && (edge.direction === 'forward' || edge.direction === 'both')
          && edge.sourceId && edge.targetId && (visible ?? available).has(edge.sourceId) && (visible ?? available).has(edge.targetId);
      }));
      return { scene, start, end: duration, visible, entering, highlight: new Set(scene.highlight), flow };
    });
    const indexAt = (seconds: number) => {
      for (let index = scenes.length - 1; index >= 0; index--) if (seconds >= scenes[index].start) return index;
      return scenes.length ? 0 : -1;
    };
    return { scenes, duration, indexAt };
  }

  function createPlayer(root: SVGSVGElement, storyboard: PlayableStoryboard, options: StoryboardPlayerOptions = {}): StoryboardController {
    const namespace = 'http://www.w3.org/2000/svg';
    let playing = false;
    let destroyed = false;
    let reduced = options.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let lastFrame: number | null = null;
    let lastReported = -Infinity;
    const originalViewBox = root.getAttribute('viewBox');
    const baseBox = (originalViewBox || `0 0 ${root.getAttribute('width') || 900} ${root.getAttribute('height') || 600}`).trim().split(/[ ,]+/).map(Number);
    const fullBox = baseBox.length === 4 && baseBox.every(Number.isFinite) && baseBox[2] > 0 && baseBox[3] > 0 ? baseBox : [0, 0, 900, 600];
    const originalStory = root.getAttribute('data-story-playing');
    const originalScene = root.getAttribute('data-story-scene');
    const originalPreview = root.getAttribute('data-story-preview');
    const typed = options.targetTable && new Map(options.targetTable.targets.map(target => [target.id, target]));
    const targets = Array.from(root.querySelectorAll<SVGGraphicsElement>('[data-element-key], [data-element-owner]')).flatMap(element => {
      const key = element.getAttribute('data-element-key') || element.getAttribute('data-element-owner') || '';
      if (typed && !typed.has(key)) return [];
      const parsedOpacity = Number.parseFloat(getComputedStyle(element).opacity);
      return [{
        element, key,
        attributes: ['style', 'aria-hidden', 'tabindex', 'role', 'aria-pressed'].map(name => [name, element.getAttribute(name)] as const),
        opacity: Number.isFinite(parsedOpacity) ? parsedOpacity : 1,
        lastOpacity: '', lastHidden: '', lastMotion: '', initialized: false,
      }];
    });
    const primary = new Map<string, SVGGraphicsElement>();
    for (const target of targets) if (target.element.hasAttribute('data-element-key') && !primary.has(target.key)) primary.set(target.key, target.element);
    const timeline = createTimeline(storyboard, [...primary.keys()], options.targetTable);
    const duration = timeline.duration;
    let time = Math.max(0, Math.min(duration, Number.isFinite(options.initialTime) ? options.initialTime! : 0));
    let previewIndex = typeof options.initialPreview === 'number' && timeline.scenes[options.initialPreview] ? options.initialPreview : null;
    if (previewIndex !== null) time = timeline.scenes[previewIndex].start;
    const baseMotion = Array.from(root.querySelectorAll<SVGElement>('[data-studio-motion]')).map(element => ({ element, style: element.getAttribute('style') }));
    for (const item of baseMotion) item.element.style.setProperty('display', 'none', 'important');
    const flowPaths: Array<{ key: string; path: SVGPathElement; display: boolean; opacity: string; offset: string; direction: number }> = [];
    const requestedFlow = new Set(storyboard.scenes.flatMap(scene => scene.flow));
    for (const [key, element] of primary) {
      if (!requestedFlow.has(key)) continue;
      const target = typed?.get(key);
      if ((target?.elementKind ?? element.getAttribute('data-element-kind')) !== 'edge' || target?.direction === 'none') continue;
      const edge = element.localName === 'path' ? element as SVGPathElement : element.querySelector<SVGPathElement>('path:not([data-studio-motion])');
      if (!edge?.getAttribute('d')) continue;
      const path = document.createElementNS(namespace, 'path');
      path.setAttribute('d', edge.getAttribute('d')!);
      if (edge.hasAttribute('transform')) path.setAttribute('transform', edge.getAttribute('transform')!);
      path.setAttribute('data-story-flow', key);
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
      flowPaths.push({ key, path, display: false, opacity: '', offset: '', direction: 1 });
      if (target?.direction === 'both') {
        const reverse = path.cloneNode() as SVGPathElement;
        path.after(reverse);
        flowPaths.push({ key, path: reverse, display: false, opacity: '', offset: '', direction: -1 });
      }
    }
    // All membership and entrance-order work happens once, not on every frame.
    const plans = timeline.scenes.map(plan => {
      const stateFor = (key: string) => {
        const shown = plan.visible === null || plan.visible.has(key);
        const entry = plan.entering.get(key);
        return {
          shown, emphasis: plan.highlight.size && !plan.highlight.has(key) ? 0.26 : 1,
          delay: entry?.delay ?? -1, anchor: entry?.anchor ?? false,
        };
      };
      return { ...plan, targets: targets.map(target => stateFor(target.key)), flows: flowPaths.map(flow => ({ ...stateFor(flow.key), active: plan.flow.has(flow.key) })) };
    });
    const ease = (value: number, kind: string) => {
      const n = Math.max(0, Math.min(1, value));
      return kind === 'linear' ? n : kind === 'ease-out' ? 1 - Math.pow(1 - n, 3) : n < 0.5 ? 4 * n * n * n : 1 - Math.pow(-2 * n + 2, 3) / 2;
    };
    const sceneIndexAt = () => previewIndex ?? timeline.indexAt(time);
    const getState = () => ({ time, duration, sceneIndex: sceneIndexAt(), playing, preview: previewIndex !== null });
    const report = (force = false) => {
      const now = performance.now();
      if (force || now - lastReported >= 80) { lastReported = now; options.onUpdate?.(getState()); }
    };
    const bounds = new Map<string, number[]>();
    const diagramRoot = typed && (root.getAttribute('data-meridian') === 'diagram'
      ? root : root.querySelector<SVGSVGElement>('svg[data-meridian="diagram"]'));
    const measureBounds = () => {
      try {
        const inverse = root.getScreenCTM()?.inverse();
        if (!inverse) return;
        const diagramMatrix = diagramRoot && diagramRoot.getScreenCTM();
        if (typed && !diagramMatrix) return;
        for (const [key, element] of primary) {
          try {
            const box = typed ? typed.get(key)?.bounds : element.getBBox();
            const matrix = typed ? diagramMatrix : element.getScreenCTM();
            if (!box || !matrix || (!box.width && !box.height)) continue;
            const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => {
              const point = root.createSVGPoint(); point.x = x; point.y = y;
              return point.matrixTransform(matrix).matrixTransform(inverse);
            });
            const left = Math.min(...points.map(point => point.x));
            const top = Math.min(...points.map(point => point.y));
            const measured = [left, top, Math.max(...points.map(point => point.x)) - left, Math.max(...points.map(point => point.y)) - top];
            if (measured.every(Number.isFinite)) bounds.set(key, measured);
          } catch { /* Unsupported geometry keeps the full-diagram fallback. */ }
        }
      } catch { /* A hidden canvas is measured when its panel becomes visible. */ }
    };
    measureBounds();
    const cameraFor = (scene: StoryScene, visible: Set<string> | null): number[] => {
      if (scene.camera.mode !== 'elements') return fullBox;
      const boxes = scene.camera.keys.filter(key => !typed || visible === null || visible.has(key))
        .map(key => bounds.get(key)).filter((box): box is number[] => Boolean(box));
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
    let cameraBoxes = plans.map(plan => cameraFor(plan.scene, plan.visible));
    let lastBox = '';
    const alphaFor = (state: { shown: boolean; emphasis: number; delay: number; anchor: boolean }, scene: StoryScene, index: number, elapsed: number) => {
      if (!state.shown) return 0;
      if (previewIndex !== null || reduced || scene.transition <= 0 || state.delay < 0 || (index === 0 && (state.anchor || scene.reveal === 'together'))) return state.emphasis;
      return ease((elapsed - state.delay) / scene.transition, scene.easing) * state.emphasis;
    };
    const paint = () => {
      const index = sceneIndexAt();
      const plan = plans[index];
      if (!plan) return;
      const scene = plan.scene;
      const elapsed = Math.max(0, time - plan.start);
      const motion = playing && !reduced ? 'running' : 'paused';
      targets.forEach((target, order) => {
        const state = plan.targets[order];
        const alpha = alphaFor(state, scene, index, elapsed);
        const opacity = String(Math.round(alpha * target.opacity * 100000) / 100000);
        if (opacity !== target.lastOpacity) { target.element.style.setProperty('opacity', opacity, 'important'); target.lastOpacity = opacity; }
        const hidden = String(alpha === 0);
        if (hidden !== target.lastHidden) {
          target.element.setAttribute('aria-hidden', hidden);
          target.element.style.setProperty('pointer-events', alpha > 0 ? 'auto' : 'none', 'important');
          target.lastHidden = hidden;
        }
        if (motion !== target.lastMotion) { target.element.style.setProperty('animation-play-state', motion, 'important'); target.lastMotion = motion; }
        if (!target.initialized) {
          target.element.style.setProperty('transition', 'none', 'important');
          if (target.element.hasAttribute('data-element-key')) {
            target.element.setAttribute('tabindex', '-1');
            if (target.element.getAttribute('role') === 'button') target.element.removeAttribute('role');
            target.element.removeAttribute('aria-pressed');
          }
          target.initialized = true;
        }
      });
      flowPaths.forEach((flow, order) => {
        const state = plan.flows[order];
        const alpha = alphaFor(state, scene, index, elapsed);
        const shown = !reduced && state.active && alpha > 0;
        if (shown !== flow.display) { flow.path.style.setProperty('display', shown ? '' : 'none'); flow.display = shown; }
        if (shown) {
          const opacity = String(alpha);
          if (opacity !== flow.opacity) { flow.path.style.setProperty('opacity', opacity); flow.opacity = opacity; }
          const position = flow.direction === 1 ? -(elapsed * 26) : elapsed * 26 + 10;
          const offset = String(Math.round((position % 100) * 1000) / 1000);
          if (offset !== flow.offset) { flow.path.setAttribute('stroke-dashoffset', offset); flow.offset = offset; }
        }
      });
      const destination = cameraBoxes[index] || fullBox;
      const origin = cameraBoxes[index - 1] || fullBox;
      const fraction = previewIndex !== null || reduced || scene.transition <= 0 ? 1 : ease(elapsed / scene.transition, scene.easing);
      const box = destination.map((value, offset) => Math.round((origin[offset] + (value - origin[offset]) * fraction) * 10000) / 10000).join(' ');
      if (box !== lastBox) { root.setAttribute('viewBox', box); lastBox = box; }
      if (root.getAttribute('data-story-scene') !== scene.id) root.setAttribute('data-story-scene', scene.id);
      if (root.getAttribute('data-story-playing') !== String(playing)) root.setAttribute('data-story-playing', String(playing));
      if (root.getAttribute('data-story-preview') !== String(previewIndex !== null)) root.setAttribute('data-story-preview', String(previewIndex !== null));
    };
    const tick = (timestamp: number) => {
      if (destroyed || !playing) return;
      if (lastFrame !== null) time += Math.max(0, (timestamp - lastFrame) / 1000);
      lastFrame = timestamp;
      if (time >= duration) {
        if (storyboard.loop && duration > 0) time %= duration;
        else { time = duration; playing = false; }
      }
      paint(); report(!playing);
      if (playing) frame = requestAnimationFrame(tick);
    };
    const pause = () => { if (destroyed) return; playing = false; cancelAnimationFrame(frame); lastFrame = null; paint(); report(true); };
    const seek = (seconds: number) => {
      if (destroyed) return;
      previewIndex = null;
      time = Math.max(0, Math.min(duration, Number.isFinite(seconds) ? seconds : 0));
      lastFrame = playing ? performance.now() : null; paint(); report(true);
    };
    const preview = (index: number) => {
      if (destroyed || !plans.length) return;
      playing = false; cancelAnimationFrame(frame); lastFrame = null;
      previewIndex = Math.max(0, Math.min(plans.length - 1, Number.isFinite(index) ? Math.floor(index) : 0));
      time = plans[previewIndex].start; paint(); report(true);
    };
    const play = () => {
      if (destroyed || playing || !plans.length) return;
      previewIndex = null;
      if (time >= duration) time = 0;
      playing = true; lastFrame = performance.now(); paint(); report(true); frame = requestAnimationFrame(tick);
    };
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibility);
    const restore = (element: Element, name: string, value: string | null) => value === null ? element.removeAttribute(name) : element.setAttribute(name, value);
    const destroy = () => {
      if (destroyed) return;
      destroyed = true; playing = false; cancelAnimationFrame(frame);
      resizeObserver?.disconnect(); document.removeEventListener('visibilitychange', visibility);
      for (const target of targets) for (const [name, value] of target.attributes) restore(target.element, name, value);
      for (const item of baseMotion) restore(item.element, 'style', item.style);
      for (const flow of flowPaths) flow.path.remove();
      restore(root, 'viewBox', originalViewBox); restore(root, 'data-story-scene', originalScene);
      restore(root, 'data-story-playing', originalStory); restore(root, 'data-story-preview', originalPreview);
    };
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (destroyed) return;
        measureBounds(); cameraBoxes = plans.map(plan => cameraFor(plan.scene, plan.visible)); paint();
      });
      resizeObserver.observe(root);
    }
    paint(); report(true);
    return {
      play, pause, seek, preview, destroy, getState,
      previous: () => { const index = Math.max(0, sceneIndexAt() - 1); if (playing) seek(plans[index]?.start ?? 0); else preview(index); },
      next: () => { const index = Math.min(plans.length - 1, sceneIndexAt() + 1); if (playing) seek(plans[index]?.start ?? duration); else preview(index); },
      restart: () => { seek(0); play(); },
      setReducedMotion: (value: boolean) => { if (destroyed) return; reduced = value; paint(); report(true); },
    };
  }
  return { createPlayer, createTimeline };
}

const runtime = createStoryboardRuntime();
export const createStoryboardPlayer = runtime.createPlayer;
export const createStoryboardTimeline = runtime.createTimeline;
