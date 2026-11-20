import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScene, createStoryboardPlayer, createStoryboardTimeline } from './storyboard';
import type { StoryboardState } from '../types/storyboard';

class Style {
  values = new Map<string, string>();
  writes = 0;
  setProperty(name: string, value: string) { this.writes++; if (value) this.values.set(name, value); else this.values.delete(name); }
  removeProperty(name: string) { this.values.delete(name); }
  restore(value: string | null) { this.values.clear(); for (const part of value?.split(';') ?? []) { const [key, ...text] = part.split(':'); if (key && text.length) this.values.set(key.trim(), text.join(':').trim()); } }
}

const identity = { inverse() { return identity; } };
class Svg {
  attributes = new Map<string, string>();
  style = new Style();
  children: Svg[] = [];
  parent: Svg | null = null;
  attributeWrites = 0;
  box = { x: 0, y: 0, width: 40, height: 20 };
  constructor(public localName = 'g', attributes: Record<string, string> = {}) { for (const [key, value] of Object.entries(attributes)) this.setAttribute(key, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  hasAttribute(name: string) { return this.attributes.has(name); }
  setAttribute(name: string, value: string) { this.attributeWrites++; this.attributes.set(name, value); if (name === 'style') this.style.restore(value); }
  removeAttribute(name: string) { this.attributes.delete(name); if (name === 'style') this.style.restore(null); }
  querySelectorAll(selector: string) { return selector === '[data-studio-motion]' ? this.children.filter(child => child.hasAttribute('data-studio-motion')) : this.children.filter(child => child.hasAttribute('data-element-key') || child.hasAttribute('data-element-owner')); }
  querySelector() { return this.children.find(child => child.localName === 'path') ?? null; }
  getBBox() { return this.box; }
  getScreenCTM() { return identity; }
  createSVGPoint() { return { x: 0, y: 0, matrixTransform() { return this; } }; }
  after(element: Svg) { if (this.parent) { element.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, element); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  append(element: Svg) { element.parent = this; this.children.push(element); }
}

let now = 0;
let nextFrame = 0;
let frames: Map<number, FrameRequestCallback>;
let listeners: Map<string, () => void>;
let documentStub: { hidden: boolean; addEventListener: (event: string, fn: () => void) => void; removeEventListener: (event: string) => void; createElementNS: (_namespace: string, name: string) => Svg };
function advance(milliseconds: number) { now += milliseconds; const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now)); }
function drawing(withEdge = false) {
  const root = new Svg('svg', { viewBox: '0 0 300 100', width: '300', height: '100' });
  const a = new Svg('g', { 'data-element-key': 'node:a', tabindex: '0', role: 'button', 'aria-pressed': 'false' });
  a.box = { x: 20, y: 30, width: 40, height: 20 };
  const b = new Svg('g', { 'data-element-key': 'node:b', tabindex: '0', role: 'button', 'aria-pressed': 'false' });
  b.box = { x: 160, y: 30, width: 40, height: 20 };
  root.append(a); root.append(b);
  if (withEdge) root.append(new Svg('path', { 'data-element-key': 'edge:ab', d: 'M60 40L160 40' }));
  return { root, a, b, svg: root as unknown as SVGSVGElement };
}
function story(): StoryboardState {
  return { version: 1, loop: false, scenes: [
    { ...createScene(), id: 'opening', duration: 2, transition: 0, visible: ['node:a'] },
    { ...createScene(1), id: 'detail', duration: 1, transition: 1, easing: 'linear', visible: null, camera: { mode: 'elements', keys: ['node:b'], padding: 8 } },
  ] };
}

beforeEach(() => {
  now = 0; nextFrame = 0; frames = new Map(); listeners = new Map();
  documentStub = { hidden: false, addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event), createElementNS: (_namespace, name) => new Svg(name) };
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('ResizeObserver', undefined);
  vi.stubGlobal('getComputedStyle', (element: Svg) => ({ opacity: element.style.values.get('opacity') ?? '1', strokeWidth: '2' }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shared storyboard playback', () => {
  it('shows a complete paused scene even when its transition lasts the whole scene, then plays its entrance', () => {
    const { svg, root, a, b } = drawing();
    const document = story(); const original = JSON.stringify(document);
    const player = createStoryboardPlayer(svg, document, { reducedMotion: false });
    expect(b.style.values.get('opacity')).toBe('0');
    player.next();
    expect(player.getState()).toMatchObject({ sceneIndex: 1, time: 2, preview: true, playing: false });
    expect(b.style.values.get('opacity')).toBe('1');
    expect(root.getAttribute('viewBox')).not.toBe('0 0 300 100');
    expect(b.getAttribute('tabindex')).toBe('-1');
    expect(b.getAttribute('role')).toBeNull();
    player.play();
    expect(player.getState()).toMatchObject({ preview: false, playing: true });
    expect(b.style.values.get('opacity')).toBe('0');
    advance(500);
    expect(player.getState().time).toBe(2.5);
    expect(b.style.values.get('opacity')).toBe('0.5');
    player.pause(); player.seek(2.75);
    expect(b.style.values.get('opacity')).toBe('0.75');
    player.previous();
    expect(player.getState()).toMatchObject({ sceneIndex: 0, preview: true, playing: false });
    expect(a.style.values.get('opacity')).toBe('1');
    expect(b.style.values.get('opacity')).toBe('0');
    player.destroy();
    expect(root.getAttribute('viewBox')).toBe('0 0 300 100');
    expect(root.getAttribute('data-story-preview')).toBeNull();
    expect(b.getAttribute('tabindex')).toBe('0');
    expect(b.getAttribute('role')).toBe('button');
    expect(b.getAttribute('aria-pressed')).toBe('false');
    expect(b.getAttribute('aria-hidden')).toBeNull();
    expect(b.style.values.size).toBe(0);
    expect(JSON.stringify(document)).toBe(original);
  });

  it('uses elapsed monotonic time across slow frames and loop boundaries, pausing in a hidden document', () => {
    const { svg } = drawing(); const document = story(); document.loop = true;
    const player = createStoryboardPlayer(svg, document, { reducedMotion: false });
    player.play(); advance(1250);
    expect(player.getState().time).toBe(1.25);
    advance(2250);
    expect(player.getState()).toMatchObject({ time: 0.5, sceneIndex: 0, playing: true });
    player.pause(); advance(3000); player.play(); advance(250);
    expect(player.getState().time).toBe(0.75);
    documentStub.hidden = true; listeners.get('visibilitychange')!();
    expect(player.getState().playing).toBe(false);
    expect(frames.size).toBe(0);
    player.destroy(); expect(listeners.size).toBe(0);
  });

  it('does not rewrite static target styles or framing on each playback frame', () => {
    const { root, svg, a, b } = drawing();
    const document: StoryboardState = { version: 1, loop: false, scenes: [{ ...createScene(), duration: 10, transition: 0 }] };
    const player = createStoryboardPlayer(svg, document, { reducedMotion: false });
    player.play();
    const writes = a.style.writes + b.style.writes + root.attributeWrites;
    advance(100); advance(100); advance(100);
    expect(a.style.writes + b.style.writes + root.attributeWrites).toBe(writes);
    player.destroy();
  });

  it('keeps flow seeking deterministic, honors reduced motion, and restores original authored styles', () => {
    const { root, svg, b } = drawing(true);
    b.setAttribute('style', 'opacity:0.38');
    const document: StoryboardState = { version: 1, loop: false, scenes: [{ ...createScene(), duration: 5, transition: 0, flow: ['edge:ab'] }] };
    const player = createStoryboardPlayer(svg, document, { reducedMotion: false, initialPreview: 0 });
    const flow = root.children.find(child => child.hasAttribute('data-story-flow'))!;
    expect(flow).toBeDefined();
    expect(flow.style.values.get('display')).toBeUndefined();
    player.seek(1); const offset = flow.getAttribute('stroke-dashoffset');
    player.seek(0.4); player.seek(1);
    expect(flow.getAttribute('stroke-dashoffset')).toBe(offset);
    expect(b.style.values.get('opacity')).toBe('0.38');
    player.setReducedMotion(true);
    expect(flow.style.values.get('display')).toBe('none');
    player.setReducedMotion(false);
    expect(flow.style.values.get('display')).toBeUndefined();
    player.destroy();
    expect(root.children.some(child => child.hasAttribute('data-story-flow'))).toBe(false);
    expect(b.style.values.get('opacity')).toBe('0.38');
  });

  it('restores a settled preview after the SVG is rebuilt', () => {
    const { svg, b } = drawing();
    const player = createStoryboardPlayer(svg, story(), { reducedMotion: false, initialTime: 2, initialPreview: 1 });
    expect(player.getState()).toMatchObject({ preview: true, sceneIndex: 1, playing: false });
    expect(b.style.values.get('opacity')).toBe('1');
    player.destroy();
  });

  it('precomputes entrance order once and ignores unavailable IDs in sequence spacing', () => {
    const first = { ...createScene(), duration: 2, transition: 0, visible: ['node:a'] };
    const second = { ...createScene(1), duration: 3, transition: 1, reveal: 'sequence' as const, visible: ['node:missing', 'node:a', 'node:b', 'node:c'] };
    const timeline = createStoryboardTimeline({ version: 1, loop: false, scenes: [first, second] }, ['node:a', 'node:b', 'node:c']);
    expect([...timeline.scenes[1].entering.keys()]).toEqual(['node:b', 'node:c']);
    expect(timeline.scenes[1].entering.get('node:b')?.delay).toBe(0);
    expect(timeline.scenes[1].entering.get('node:c')?.delay).toBe(1);
    expect(timeline.indexAt(2)).toBe(1);
    expect(timeline.duration).toBe(5);
  });
});
