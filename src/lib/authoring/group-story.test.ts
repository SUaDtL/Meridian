import { expect, test } from 'vitest';
import { suggestGroupScenes } from './group-story';
import { resolveStoryPath, suggestPathScene } from './path-story';
import type { RenderTargetTable } from './project-render';

type Target = RenderTargetTable['targets'][number];
function target(id: string, elementKind: Target['elementKind'], extra: Partial<Target> = {}): Target {
  return { id, elementKind, label: id, parentId: null, members: [], sourceId: null, targetId: null, direction: null,
    bounds: { x: 0, y: 0, width: 10, height: 10 }, ...extra };
}

test('includes only an opted-in boundary hop and directs camera at its leaves and connection', () => {
  const table: RenderTargetTable = {
    schema: 'meridian-targets/v1', renderFingerprint: 'current',
    baseToken: { projectId: 'project', revision: 1, contentHash: 'source', stateDigest: 'document' },
    targets: [
      target('group', 'group', { members: ['a'] }), target('a', 'node', { parentId: 'group' }), target('b', 'node'), target('c', 'node'),
      target('one-hop', 'edge', { sourceId: 'a', targetId: 'b', direction: 'forward' }),
      target('second-hop', 'edge', { sourceId: 'b', targetId: 'c', direction: 'forward' }),
    ],
  };
  const [suggestion] = suggestGroupScenes(table, { groups: [{ id: 'group', depth: 1, boundary: true }],
    overview: false, ungrouped: false, animate: true, duration: 5 });
  expect(suggestion.scene.visible).toEqual(['group', 'a', 'b', 'one-hop']);
  expect(suggestion.scene.flow).toEqual(['one-hop']);
  expect(suggestion.scene.camera.keys).toEqual(['a', 'b', 'one-hop']);
  expect(suggestion.coverage).toEqual({ node: { shown: 2, omitted: 1 }, edge: { shown: 1, omitted: 1 }, group: { shown: 1, omitted: 0 } });
});

test('includes a chosen path loop once and keeps reversed or undirected steps still', () => {
  const table: RenderTargetTable = {
    schema: 'meridian-targets/v1', renderFingerprint: 'current',
    baseToken: { projectId: 'project', revision: 1, contentHash: 'source', stateDigest: 'document' },
    targets: [
      target('outer', 'group', { members: ['inner'] }), target('inner', 'group', { parentId: 'outer', members: ['a', 'b', 'sibling'] }),
      target('a', 'node', { parentId: 'inner' }), target('b', 'node', { parentId: 'inner' }), target('sibling', 'node', { parentId: 'inner' }),
      target('c', 'node'), target('neighbor', 'node'), target('distant', 'node'),
      target('ab', 'edge', { sourceId: 'a', targetId: 'b', direction: 'forward' }),
      target('cb', 'edge', { sourceId: 'c', targetId: 'b', direction: 'forward' }),
      target('ca', 'edge', { sourceId: 'c', targetId: 'a', direction: 'none' }),
      target('context', 'edge', { sourceId: 'b', targetId: 'neighbor', direction: 'forward' }),
      target('second-hop', 'edge', { sourceId: 'neighbor', targetId: 'distant', direction: 'forward' }),
    ],
  };
  const steps = [{ edgeId: 'ab', traversal: 'forward' }, { edgeId: 'cb', traversal: 'reverse' }, { edgeId: 'ca', traversal: 'forward' }] as const;
  const resolved = resolveStoryPath(table, 'a', steps);
  expect(resolved.loop?.id).toBe('a');
  expect(resolved.following).toEqual([]);
  expect(() => resolveStoryPath(table, 'a', [...steps, steps[0]])).toThrow('first loop');
  const [suggestion] = suggestPathScene(table, { startId: 'a', steps: [...steps], title: '', duration: 5, animate: true, includeContext: true });
  expect(suggestion.scene.title).toBe('Loop returns to a');
  expect(suggestion.scene.visible).toEqual(['outer', 'inner', 'a', 'b', 'c', 'neighbor', 'ab', 'cb', 'ca', 'context']);
  expect(suggestion.scene.flow).toEqual(['ab']);
  expect(suggestion.scene.camera.keys).not.toContain('inner');
  expect(suggestion.coverage.node).toEqual({ shown: 4, omitted: 2 });
});
