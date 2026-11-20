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
