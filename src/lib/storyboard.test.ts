import { describe, expect, it } from 'vitest';
import { createEmptyStoryboard, createScene, duplicateScene, expandStorySelection, missingStoryTargets, removeMissingStoryTargets, restoreMissingStoryTargets, sceneStartTime, storyboardDuration, validateStoryboard } from './storyboard';
import type { RenderElement } from '../types/design';

describe('portable storyboard boundary', () => {
  it('migrates absent storyboards and round trips scenes without dropping missing source references', () => {
    expect(validateStoryboard(undefined)).toEqual(createEmptyStoryboard());
    const scene = createScene();
    scene.visible = ['node:gateway', 'group:Region', 'edge:gateway:server:0:0'];
    scene.highlight = ['node:gateway'];
    scene.flow = ['edge:gateway:server:0:0'];
    scene.camera = { mode: 'elements', keys: ['node:gateway', 'node:temporarily-removed'], padding: 56 };
    const storyboard = { version: 1 as const, scenes: [scene], loop: true };
    const validated = validateStoryboard(JSON.parse(JSON.stringify(storyboard)));
    expect(validated).toEqual(storyboard);
    validated.scenes[0].camera.keys.push('node:another');
    expect(scene.camera.keys).not.toContain('node:another');
  });

  it('copies scene arrays independently and preserves progressive visibility when adding a scene', () => {
    const first = createScene();
    first.visible = ['node:a']; first.highlight = ['node:a'];
    first.camera = { mode: 'elements', keys: ['node:a'], padding: 40 };
    const copy = duplicateScene(first);
    expect(copy.id).not.toBe(first.id);
    expect(copy.title).toBe('Scene 1 copy');
    copy.visible!.push('node:b'); copy.highlight.push('node:b'); copy.camera.keys.push('node:b');
    expect(first.visible).toEqual(['node:a']);
    expect(first.highlight).toEqual(['node:a']);
    expect(first.camera.keys).toEqual(['node:a']);
    const next = createScene(1, first);
    next.visible!.push('node:c');
    expect(first.visible).toEqual(['node:a']);
    expect(next.title).toBe('Scene 2');
  });

  it('calculates scene positions from durations, including fractional transitions and reordering', () => {
    const a = { ...createScene(), duration: 2.5, transition: 0.3 };
    const b = { ...createScene(1), duration: 7 };
    const c = { ...createScene(2), duration: 0.5, transition: 0 };
    const story = { version: 1 as const, loop: false, scenes: [a, b, c] };
    expect(sceneStartTime(story, 0)).toBe(0);
    expect(sceneStartTime(story, 1)).toBe(2.5);
    expect(sceneStartTime(story, 2)).toBe(9.5);
    expect(storyboardDuration(story)).toBe(10);
    expect(sceneStartTime({ ...story, scenes: [c, a, b] }, 2)).toBe(3);
  });

  it('expands a group through nested members and includes only its internal connections', () => {
    const item = (key: string, kind: RenderElement['kind'], extra: Partial<RenderElement> = {}): RenderElement => ({ key, kind, sourceId: key, label: key, capabilities: [], ...extra });
    const elements = [
      item('group:outer', 'group', { members: ['node:a', 'group:inner'] }),
      item('group:inner', 'group', { members: ['node:b', 'node:c'] }),
      item('node:a', 'node'), item('node:b', 'node'), item('node:c', 'node'), item('node:outside', 'node'),
      item('edge:inside', 'edge', { from: 'node:a', to: 'node:b' }),
      item('edge:outside', 'edge', { from: 'node:c', to: 'node:outside' }),
    ];
    expect(expandStorySelection('group:outer', elements)).toEqual(['group:outer', 'node:a', 'group:inner', 'node:b', 'node:c', 'edge:inside']);
    expect(expandStorySelection('node:a', elements)).toEqual(['node:a']);
    expect(expandStorySelection('node:missing', elements)).toEqual([]);
  });

  it('rejects malformed timelines before they reach the player', () => {
    const scene = createScene();
    const patches = [
      { duration: NaN }, { duration: 0 }, { duration: 121 }, { transition: -1 }, { transition: 6 },
      { easing: ['linear'] }, { reveal: { toString: () => 'together' } },
      { visible: ['node:a', 'node:a'] }, { visible: ['javascript:alert(1)'] },
      { flow: ['node:a'] }, { camera: { ...scene.camera, padding: Infinity } },
      { script: 'alert(1)' }, { style: 'background:url(https://example.invalid)' },
    ];
    for (const patch of patches) expect(() => validateStoryboard({ version: 1, loop: false, scenes: [{ ...scene, ...patch }] })).toThrow();
    expect(() => validateStoryboard({ version: 1, loop: false, scenes: [scene, scene] })).toThrow(/unique/);
    expect(() => validateStoryboard({ version: 99, loop: false, scenes: [] })).toThrow(/version/);
    expect(() => validateStoryboard({ version: 1, loop: 'false', scenes: [] })).toThrow(/true or false/);
    expect(() => validateStoryboard({ version: 1, loop: false, scenes: Array.from({ length: 51 }, (_, index) => createScene(index)) })).toThrow(/50/);
  });

  it('reports missing targets once and removes them only through explicit reconciliation', () => {
    const scene = createScene();
    scene.visible = ['node:a', 'node:removed'];
    scene.highlight = ['node:removed'];
    scene.flow = ['edge:removed'];
    scene.camera.keys = ['node:a', 'node:removed'];
    const available = new Set(['node:a', 'node:b']);
    const missing = missingStoryTargets(scene, available);
    expect(missing.keys).toEqual(['node:removed', 'edge:removed']);
    const cleaned = removeMissingStoryTargets(scene, available);
    expect(cleaned.visible).toEqual(['node:a']);
    expect(cleaned.highlight).toEqual([]);
    expect(cleaned.flow).toEqual([]);
    expect(cleaned.camera.keys).toEqual(['node:a']);
    expect(scene.visible).toContain('node:removed');
    expect(scene.flow).toEqual(['edge:removed']);
  });

  it('undoes missing-target removal without discarding later target additions', () => {
    const scene = createScene(); scene.visible = ['node:a', 'node:removed']; scene.highlight = ['node:removed'];
    const available = new Set(['node:a', 'node:b']);
    const missing = missingStoryTargets(scene, available);
    const cleaned = removeMissingStoryTargets(scene, available);
    cleaned.visible!.push('node:b'); cleaned.highlight = ['node:b'];
    const restored = restoreMissingStoryTargets(cleaned, missing);
    expect(restored.visible).toEqual(['node:a', 'node:b', 'node:removed']);
    expect(restored.highlight).toEqual(['node:b', 'node:removed']);
    expect(restoreMissingStoryTargets({ ...cleaned, visible: null }, missing).visible).toBeNull();
  });

  it('rejects prototype fields at every structural level', () => {
    const scene = createScene();
    const proto = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => validateStoryboard({ ...createEmptyStoryboard(), ...proto })).toThrow();
    expect(() => validateStoryboard({ version: 1, loop: false, scenes: [{ ...scene, ...proto }] })).toThrow();
    expect(() => validateStoryboard({ version: 1, loop: false, scenes: [{ ...scene, camera: { ...scene.camera, ...proto } }] })).toThrow();
    expect(Object.hasOwn(Object.prototype, 'polluted')).toBe(false);
  });
});
