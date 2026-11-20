import { sameBaseToken, type BaseToken } from '../authoring/base-token';
import type { GroupStoryOptions } from '../authoring/group-story';
import { elementUuidPattern } from '../authoring/identities';
import { pathStepLimit, type PathStoryOptions } from '../authoring/path-story';
import type { StoryDestination } from '../authoring/project-editor';
import common from '../authoring/schemas/common.schema.json';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';
import { draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

export type PathDraft = Omit<PathStoryOptions, 'animate' | 'duration'> & { id: string };
export type StoryDraft = GroupStoryOptions & {
  destination: StoryDestination;
  strategy: 'groups' | 'path';
  paths: PathDraft[];
};
const pathKeyPattern = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
export const emptyPathDraft = (): PathDraft => ({ id: 'selected-path', startId: '', steps: [], includeContext: false, title: '' });
const unicodeTitle = /[\u0000-\u001f\u007f\uD800-\uDFFF]/u;

function checkTitle(value: unknown, overrides: Record<string, { title: string }>, key: string) {
  if (value === undefined || value === '') return;
  if (typeof value !== 'string' || [...value].length > 120 || unicodeTitle.test(value)) throw new Error('Use a well-formed scene title of up to 120 characters.');
  overrides[key] = { title: value };
}

function storyCheckpoint(draft: StoryDraft, baseToken: BaseToken, id: string, now: number) {
  if (typeof id !== 'string' || !elementUuidPattern.test(id) || !Number.isFinite(now)
    || !matchesBundledContract(baseToken, common.$defs.BaseToken)
    || (draft.strategy !== 'groups' && draft.strategy !== 'path')
    || (draft.destination !== 'append' && draft.destination !== 'replace' && draft.destination !== 'duplicate')
    || typeof draft.overview !== 'boolean' || typeof draft.ungrouped !== 'boolean' || typeof draft.animate !== 'boolean'
    || !Number.isFinite(draft.duration) || draft.duration < 0.5 || draft.duration > 120) {
    throw new Error('The story draft is incomplete.');
  }
  const isPath = draft.strategy === 'path';
  const overrides: Record<string, { title: string }> = {};
  const groups = isPath ? [] : draft.groups.map(({ id, depth, boundary, title }) => {
    if (!elementUuidPattern.test(id) || !Number.isInteger(depth) || depth < 1 || depth > 4 || typeof boundary !== 'boolean') {
      throw new Error('Choose verified diagram groups for this draft.');
    }
    checkTitle(title, overrides, `group:${id}`);
    return { groupId: id, depth, includeBoundary: boundary };
  });
  if (new Set(groups.map(group => group.groupId)).size !== groups.length
    || groups.length + Number(draft.overview) + Number(draft.ungrouped) > 20) throw new Error('Choose at most 20 distinct group scenes.');
  const paths = isPath ? draft.paths.map(({ id, startId, steps, includeContext, title }) => {
    if (typeof id !== 'string' || !pathKeyPattern.test(id) || !elementUuidPattern.test(startId) || typeof includeContext !== 'boolean' || steps.length > pathStepLimit) {
      throw new Error(`Choose a start node and up to ${pathStepLimit} connections for each path.`);
    }
    const checked = steps.map(({ edgeId, traversal }) => {
      if (!elementUuidPattern.test(edgeId) || (traversal !== 'forward' && traversal !== 'reverse')) throw new Error('A chosen path connection is invalid.');
      return { edgeId, traverse: traversal };
    });
    checkTitle(title, overrides, `path:${id}`);
    return { id, startId, steps: checked, includeContext };
  }) : [];
  if (isPath && (!paths.length || paths.length > 20 || new Set(paths.map(path => path.id)).size !== paths.length)) {
    throw new Error('Choose up to 20 distinct path scenes.');
  }
  return {
    schema: 'meridian-draft/v1' as const, feature: 'story' as const, id, baseToken,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + draftWeek).toISOString(),
    payload: {
      strategy: isPath ? 'paths' as const : 'groups' as const, groups, paths,
      overview: !isPath && draft.overview, includeUngrouped: !isPath && draft.ungrouped,
      motion: draft.animate ? 'flow' as const : 'none' as const,
      pacing: { duration: draft.duration, transition: 0.3, cameraPadding: 56 },
      sceneOverrides: overrides, destination: draft.destination,
    },
  };
}

export type StoryCheckpoint = ReturnType<typeof storyCheckpoint>;

export function resumeStoryCheckpoint({ payload }: StoryCheckpoint): StoryDraft {
  return {
    strategy: payload.strategy === 'paths' ? 'path' : 'groups',
    groups: payload.groups.map(({ groupId, depth, includeBoundary }) =>
      ({ id: groupId, depth, boundary: includeBoundary, title: payload.sceneOverrides[`group:${groupId}`]?.title })),
    paths: payload.paths.length ? payload.paths.map(path => ({
      id: path.id, startId: path.startId, steps: path.steps.map(({ edgeId, traverse }) => ({ edgeId, traversal: traverse })),
      includeContext: path.includeContext, title: payload.sceneOverrides[`path:${path.id}`]?.title || '',
    })) : [emptyPathDraft()],
    overview: payload.overview,
    ungrouped: payload.includeUngrouped,
    duration: payload.pacing.duration,
    animate: payload.motion === 'flow',
    destination: payload.destination,
  };
}

export function listStoryCheckpoints(db: IDBDatabase, projectId: string) {
  return listGuidedCheckpoints(db, value => {
    try {
      const record = value as StoryCheckpoint;
      if (record?.feature !== 'story' || record.baseToken?.projectId !== projectId) return undefined;
      const expected = storyCheckpoint(resumeStoryCheckpoint(record), record.baseToken, record.id, Date.parse(record.createdAt));
      return sameCheckpoint(record, expected) && draftBytes(expected) <= maxDraftBytes ? expected : undefined;
    } catch { return undefined; }
  });
}

export function saveStoryCheckpoint(db: IDBDatabase, draft: StoryDraft, baseToken: BaseToken, previous?: StoryCheckpoint) {
  const now = Date.now();
  const next = storyCheckpoint(draft, baseToken, previous?.id ?? crypto.randomUUID(), now);
  return saveGuidedCheckpoint(db, next, previous, now);
}

export function isCurrentStoryDraft(draft: StoryCheckpoint, current: BaseToken) {
  return sameBaseToken(draft.baseToken, current);
}
