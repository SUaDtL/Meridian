import { elementUuidPattern } from '../authoring/identities';
import { normalizeSystemsDraft, type SystemsDraft } from '../authoring/systems-draft';
import { draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

function systemsCheckpoint(input: SystemsDraft, id: string, now: number) {
  if (!elementUuidPattern.test(id) || !Number.isFinite(now)) throw new Error('The draft identity or saved time is invalid.');
  const { title, direction, nodes, edges } = normalizeSystemsDraft(input);
  return {
    schema: 'meridian-draft/v1' as const, id, feature: 'guided' as const, baseToken: null,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + draftWeek).toISOString(),
    payload: {
      intent: 'systems' as const, mode: 'connections' as const, step: 'connections' as const,
      title, subtitle: '', direction, destination: { mode: 'new' as const, targetProjectId: null },
      nodes: nodes.map(node => ({ ...node, sourceRow: null })),
      edges: edges.map(edge => ({ ...edge, review: 'accepted' as const })),
      groups: [], terminalNodeIds: [], mapping: { id: null, label: null, source: null, target: null, role: null },
    },
  };
}
export type SystemsCheckpoint = ReturnType<typeof systemsCheckpoint>;

export function resumeSystemsDraft({ payload }: SystemsCheckpoint): SystemsDraft {
  return normalizeSystemsDraft(payload);
}

export function listSystemsDrafts(db: IDBDatabase) {
  return listGuidedCheckpoints(db, value => {
    try {
      const record = value as SystemsCheckpoint;
      if (record?.feature !== 'guided' || record.payload?.intent !== 'systems' || record.payload.mapping.label !== null) return undefined;
      const expected = systemsCheckpoint(resumeSystemsDraft(record), record.id, Date.parse(record.createdAt));
      return sameCheckpoint(record, expected) && draftBytes(expected) <= maxDraftBytes ? expected : undefined;
    } catch {
      return undefined;
    }
  });
}

export function saveSystemsDraft(db: IDBDatabase, draft: SystemsDraft, previous?: SystemsCheckpoint) {
  const now = Date.now();
  return saveGuidedCheckpoint(db, systemsCheckpoint(draft, previous?.id ?? crypto.randomUUID(), now), previous, now);
}
