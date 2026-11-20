import { createScene } from '../storyboard';
import type { StoryScene } from '../../types/storyboard';
import type { RenderTargetTable } from './project-render';

type Target = RenderTargetTable['targets'][number];
export type GroupStoryChoice = { id: string; depth: number; boundary: boolean; title?: string };
export type GroupStoryOptions = {
  groups: GroupStoryChoice[];
  overview: boolean;
  ungrouped: boolean;
  animate: boolean;
  duration: number;
};
export type SceneCoverage = Record<Target['elementKind'], { shown: number; omitted: number }>;

const targetLimit = 1_500;
const sceneLimit = 20;
const maxDepth = 4;

function countCoverage(table: RenderTargetTable, visible: ReadonlySet<string> | null): SceneCoverage {
  const groups: SceneCoverage = { node: { shown: 0, omitted: 0 }, edge: { shown: 0, omitted: 0 }, group: { shown: 0, omitted: 0 } };
  for (const target of table.targets) groups[target.elementKind][!visible || visible.has(target.id) ? 'shown' : 'omitted']++;
  return groups;
}

/** Suggest ordinary scene records using only the verified render identities and membership. */
export function suggestGroupScenes(table: RenderTargetTable, options: GroupStoryOptions) {
  if (table.targets.length > targetLimit) throw new Error('Choose a diagram with at most 1,500 verified story targets.');
  const count = options.groups.length + Number(options.overview) + Number(options.ungrouped);
  if (!count || count > sceneLimit || new Set(options.groups.map(group => group.id)).size !== options.groups.length) {
    throw new Error('Choose up to 20 distinct scenes.');
  }
  if (!Number.isFinite(options.duration) || options.duration < 0.5 || options.duration > 120) {
    throw new Error('Use a scene duration between 0.5 and 120 seconds.');
  }
  const byId = new Map(table.targets.map(target => [target.id, target]));
  const edges = table.targets.filter(target => target.elementKind === 'edge');
  const result: { scene: StoryScene; coverage: SceneCoverage }[] = [];

  function addContainers(visible: Set<string>) {
    for (const id of [...visible]) {
      for (let parent = byId.get(id)?.parentId; parent && !visible.has(parent); parent = byId.get(parent)?.parentId) {
        if (byId.get(parent)?.elementKind !== 'group') throw new Error('The current group ancestry could not be verified.');
        visible.add(parent);
      }
    }
  }

  function trueEndpoints(edge: Target, content: ReadonlySet<string>) {
    return edge.sourceId !== null && edge.targetId !== null && content.has(edge.sourceId) && content.has(edge.targetId);
  }

  function makeScene(title: string, content: Set<string> | null, boundary = false) {
    const visible = content && new Set(content);
    if (visible && content) {
      for (const edge of edges) {
        if (trueEndpoints(edge, content)) visible.add(edge.id);
        else if (boundary && edge.sourceId && edge.targetId) {
          const opposite = content.has(edge.sourceId) ? edge.targetId : content.has(edge.targetId) ? edge.sourceId : null;
          if (opposite && byId.get(opposite)?.elementKind === 'node') { visible.add(opposite); visible.add(edge.id); }
        }
      }
      addContainers(visible);
    }
    const ordered = visible ? table.targets.filter(target => visible.has(target.id)) : table.targets;
    const flow = options.animate ? edges.filter(edge => edge.direction !== 'none' && edge.direction !== null
      && (!visible || (visible.has(edge.id) && trueEndpoints(edge, visible)))).map(edge => edge.id) : [];
    const keys = visible ? ordered.filter(target => target.elementKind !== 'group').map(target => target.id) : [];
    const scene: StoryScene = {
      ...createScene(result.length), title: title.slice(0, 120).replace(/[\uD800-\uDBFF]$/, ''), duration: options.duration, transition: 0.3,
      visible: visible ? ordered.map(target => target.id) : null, flow,
      camera: { mode: keys.length ? 'elements' : 'fit', keys, padding: 56 },
    };
    result.push({ scene, coverage: countCoverage(table, visible) });
  }

  function addedMembers(group: Target, depth: number, selected: Set<string>) {
    for (const id of group.members) {
      const child = byId.get(id);
      if (!child || child.parentId !== group.id) throw new Error('The current group membership could not be verified.');
      if (child.elementKind === 'node') selected.add(child.id);
      else if (child.elementKind === 'group' && depth > 1) {
        const previous = selected.size;
        addedMembers(child, depth - 1, selected);
        if (selected.size > previous) selected.add(child.id);
      }
    }
  }

  if (options.overview) makeScene('Diagram overview', null);
  for (const choice of options.groups) {
    const group = byId.get(choice.id);
    if (!group || group.elementKind !== 'group' || !Number.isInteger(choice.depth) || choice.depth < 1 || choice.depth > maxDepth) {
      throw new Error('Choose a current diagram group and a depth from one to four.');
    }
    const content = new Set([group.id]);
    addedMembers(group, choice.depth, content);
    makeScene(choice.title?.trim() || group.label || 'Diagram group', content, choice.boundary);
  }
  if (options.ungrouped) {
    const nodes = new Set(table.targets.filter(target => target.elementKind === 'node' && target.parentId === null).map(target => target.id));
    if (!nodes.size) throw new Error('The current diagram has no ungrouped nodes.');
    makeScene('Ungrouped nodes', nodes);
  }
  return result;
}
