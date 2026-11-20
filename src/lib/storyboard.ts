import type { StoryboardState, StoryScene } from '../types/storyboard';
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

export interface MissingStoryTargets {
  visible: string[];
  highlight: string[];
  flow: string[];
  camera: string[];
  keys: string[];
}

export function missingStoryTargets(scene: StoryScene, available: ReadonlySet<string>): MissingStoryTargets {
  const missing = (keys: string[]) => keys.filter(key => !available.has(key));
  const targets = {
    visible: missing(scene.visible ?? []), highlight: missing(scene.highlight),
    flow: missing(scene.flow), camera: missing(scene.camera.keys),
  };
  return { ...targets, keys: [...new Set(Object.values(targets).flat())] };
}

/** Missing source references are retained until the user explicitly removes them. */
export function removeMissingStoryTargets(scene: StoryScene, available: ReadonlySet<string>): StoryScene {
  const keep = (keys: string[]) => keys.filter(key => available.has(key));
  return { ...scene, visible: scene.visible === null ? null : keep(scene.visible), highlight: keep(scene.highlight), flow: keep(scene.flow), camera: { ...scene.camera, keys: keep(scene.camera.keys) } };
}

/** Undo only restores the removed references, preserving subsequent edits. */
export function restoreMissingStoryTargets(scene: StoryScene, missing: MissingStoryTargets): StoryScene {
  const merge = (keys: string[], restored: string[]) => [...new Set([...keys, ...restored])].slice(0, 1500);
  return { ...scene, visible: scene.visible === null ? null : merge(scene.visible, missing.visible), highlight: merge(scene.highlight, missing.highlight), flow: merge(scene.flow, missing.flow), camera: { ...scene.camera, keys: merge(scene.camera.keys, missing.camera) } };
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

export { createStoryboardPlayer, createStoryboardRuntime, createStoryboardTimeline } from './storyboard-runtime';
