import { expect, test } from 'vitest';
import { suggestGroupScenes } from './group-story';
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
