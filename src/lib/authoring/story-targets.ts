import type { RenderTargetTable } from './project-render';

export type StoryTarget = RenderTargetTable['targets'][number];
export type SceneCoverage = Record<StoryTarget['elementKind'], { shown: number; omitted: number }>;
export const storyTargetLimit = 1_500;

export function countStoryCoverage(table: RenderTargetTable, visible: ReadonlySet<string> | null): SceneCoverage {
  const coverage: SceneCoverage = { node: { shown: 0, omitted: 0 }, edge: { shown: 0, omitted: 0 }, group: { shown: 0, omitted: 0 } };
  for (const target of table.targets) coverage[target.elementKind][!visible || visible.has(target.id) ? 'shown' : 'omitted']++;
  return coverage;
}

/** Add the necessary group containers without including any of their other contents. */
export function addStoryAncestors(visible: Set<string>, byId: ReadonlyMap<string, StoryTarget>) {
  for (const id of [...visible]) {
    for (let parent = byId.get(id)?.parentId; parent && !visible.has(parent); parent = byId.get(parent)?.parentId) {
      if (byId.get(parent)?.elementKind !== 'group') throw new Error('The current group ancestry could not be verified.');
      visible.add(parent);
    }
  }
}

export function resolveManualStoryScope(table: RenderTargetTable, selected: readonly string[]) {
  const visible = new Set(selected);
  if (!visible.size || visible.size !== selected.length || visible.size > storyTargetLimit) {
    throw new Error('Choose a bounded selection of distinct nodes and connections.');
  }
  const byId = new Map(table.targets.map(target => [target.id, target]));
  for (const id of selected) {
    const target = byId.get(id);
    if (!target || target.elementKind === 'group') throw new Error('The manual scene needs current nodes or connections.');
    if (target.elementKind === 'edge') {
      for (const endpoint of [target.sourceId, target.targetId]) {
        if (!endpoint || byId.get(endpoint)?.elementKind !== 'node') throw new Error('The scene needs both verified node endpoints of each connection.');
        visible.add(endpoint);
      }
    }
  }
  addStoryAncestors(visible, byId);
  if (visible.size > storyTargetLimit) throw new Error('The scene exceeds 1,500 visible elements after including endpoints and groups.');
  const ordered = table.targets.filter(item => visible.has(item.id));
  return { visible: ordered.map(item => item.id), cameraKeys: ordered.filter(item => item.elementKind !== 'group').map(item => item.id),
    coverage: countStoryCoverage(table, visible) };
}
