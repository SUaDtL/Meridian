import { createScene } from '../storyboard';
import type { StoryScene } from '../../types/storyboard';
import type { RenderTargetTable } from './project-render';
import { addStoryAncestors, countStoryCoverage, storyTargetLimit, type StoryTarget } from './story-targets';

export type PathStep = { edgeId: string; traversal: 'forward' | 'reverse' };
export type PathStoryOptions = {
  startId: string;
  steps: PathStep[];
  includeContext: boolean;
  title: string;
  animate: boolean;
  duration: number;
};
export const pathStepLimit = 200;

function traverse(edge: StoryTarget | undefined, from: string, direction: PathStep['traversal']) {
  if (edge?.elementKind !== 'edge' || edge.direction === null) return undefined;
  if (direction === 'forward' && edge.sourceId === from) return edge.targetId ?? undefined;
  if (direction === 'reverse' && edge.targetId === from) return edge.sourceId ?? undefined;
}

export function resolveStoryPath(table: RenderTargetTable, startId: string, steps: readonly PathStep[]) {
  if (table.targets.length > storyTargetLimit) throw new Error('Choose a diagram with at most 1,500 verified story targets.');
  if (steps.length > pathStepLimit) throw new Error(`Choose a path with up to ${pathStepLimit} connections.`);
  const byId = new Map(table.targets.map(item => [item.id, item]));
  const start = byId.get(startId);
  if (start?.elementKind !== 'node') throw new Error('Choose a current node as the path start.');
  const nodes = new Set([start.id]);
  const edges = new Set<string>();
  const motion = new Set<string>();
  let endpoint = start;
  let loop: StoryTarget | undefined;
  for (const step of steps) {
    if (loop) throw new Error('Finish the path where the first loop returns to a visited node.');
    const edge = byId.get(step.edgeId);
    const nextId = traverse(edge, endpoint.id, step.traversal);
    const next = nextId && byId.get(nextId);
    if (!edge || !next || next.elementKind !== 'node') throw new Error('Choose a current connection from the end of the path.');
    if (nodes.has(next.id)) loop = next;
    nodes.add(next.id);
    edges.add(edge.id);
    if (step.traversal === 'forward' && edge.direction === 'forward') motion.add(edge.id);
    endpoint = next;
  }
  const following = loop || steps.length === pathStepLimit ? [] : table.targets.flatMap(edge => {
    if (edge.elementKind !== 'edge') return [];
    return (['forward', 'reverse'] as const).flatMap(traversal => {
      const nextId = traverse(edge, endpoint.id, traversal);
      const next = nextId && byId.get(nextId);
      if (!next || next.elementKind !== 'node' || (traversal === 'reverse' && next.id === endpoint.id)) return [];
      return [{ edge, traversal, next }];
    });
  });
  return { byId, start, endpoint, nodes, edges, motion, loop, following };
}

export function suggestPathScene(table: RenderTargetTable, options: PathStoryOptions) {
  if (!Number.isFinite(options.duration) || options.duration < 0.5 || options.duration > 120) {
    throw new Error('Use a scene duration between 0.5 and 120 seconds.');
  }
  const path = resolveStoryPath(table, options.startId, options.steps);
  const chosen = new Set([...path.nodes, ...path.edges]);
  const visible = new Set(chosen);
  if (options.includeContext) {
    for (const edge of table.targets) {
      if (edge.elementKind !== 'edge' || !edge.sourceId || !edge.targetId) continue;
      const oppositeId = path.nodes.has(edge.sourceId) ? edge.targetId : path.nodes.has(edge.targetId) ? edge.sourceId : null;
      if (oppositeId && path.byId.get(oppositeId)?.elementKind === 'node') {
        visible.add(oppositeId);
        visible.add(edge.id);
      }
    }
  }
  addStoryAncestors(visible, path.byId);
  const ordered = table.targets.filter(target => visible.has(target.id));
  const label = (target: StoryTarget) => target.label || 'Unnamed node';
  const defaultTitle = path.loop ? `Loop returns to ${label(path.loop)}`
    : path.start === path.endpoint ? label(path.start) : `${label(path.start)} to ${label(path.endpoint)}`;
  const scene: StoryScene = {
    ...createScene(0), title: (options.title.trim() || defaultTitle).slice(0, 120).replace(/[\uD800-\uDBFF]$/, ''),
    duration: options.duration, transition: 0.3, visible: ordered.map(target => target.id),
    highlight: ordered.filter(target => chosen.has(target.id)).map(target => target.id),
    flow: options.animate ? [...path.motion] : [],
    camera: { mode: 'elements', keys: ordered.filter(target => target.elementKind !== 'group').map(target => target.id), padding: 56 },
  };
  return [{ scene, coverage: countStoryCoverage(table, visible) }];
}
