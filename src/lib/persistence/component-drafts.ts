import type { BaseToken } from '../authoring/base-token';
import { elementUuidPattern } from '../authoring/identities';
import common from '../authoring/schemas/common.schema.json';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';
import { draftBytes, draftWeek, listGuidedCheckpoints, maxDraftBytes, sameCheckpoint, saveGuidedCheckpoint } from './guided-drafts';

type DraftPort = { portId: string; targetId: string | null; direction: 'in' | 'out' | null };
export type ComponentDraft = {
  step: 'parameters' | 'connections' | 'review';
  definitionId: string;
  definitionVersion: string;
  definitionHash: string;
  parameters: Record<string, string | number>;
  destination: { mode: 'new' | 'insert'; targetProjectId: string | null };
  connections: DraftPort[];
};

const localId = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const invalidText = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\uD800-\uDFFF]/u;

function componentCheckpoint(payload: ComponentDraft, baseToken: BaseToken | null, id: string, now: number) {
  const { step, definitionId, definitionVersion, definitionHash, parameters, destination, connections } = payload;
  if (!elementUuidPattern.test(id) || !Number.isFinite(now) || !['parameters', 'connections', 'review'].includes(step)
    || !matchesBundledContract(definitionId, common.$defs.UUID) || !matchesBundledContract(definitionHash, common.$defs.Sha256)
    || typeof definitionVersion !== 'string' || definitionVersion.length > 40 || invalidText.test(definitionVersion)
    || !parameters || typeof parameters !== 'object' || Array.isArray(parameters) || !Array.isArray(connections)) {
    throw new Error('The component draft is incomplete.');
  }
  const entries = Object.entries(parameters);
  if (entries.length > 32 || entries.some(([id, value]) => !localId.test(id) || (typeof value === 'string'
    ? [...value].length > 200 || invalidText.test(value) : !Number.isInteger(value) || value < -1000 || value > 1000))) {
    throw new Error('Use well-formed parameter values before saving the component draft.');
  }
  if (!(destination?.mode === 'new' && destination.targetProjectId === null && baseToken === null
    || destination?.mode === 'insert' && baseToken && destination.targetProjectId === baseToken.projectId
      && matchesBundledContract(baseToken, common.$defs.BaseToken))) {
    throw new Error('Choose a current destination for this component draft.');
  }
  if (connections.length > 16 || new Set(connections.map(item => item.portId)).size !== connections.length) {
    throw new Error('Save at most 16 distinct attachment choices.');
  }
  const ports = connections.map(({ portId, targetId, direction }) => {
    if (typeof portId !== 'string' || !localId.test(portId) || !(targetId === null ? direction === null
      : destination.mode === 'insert' && matchesBundledContract(targetId, common.$defs.UUID)
        && (direction === null || direction === 'in' || direction === 'out'))) {
      throw new Error('An attachment choice is invalid.');
    }
    return { portId, targetId, direction };
  });
  return {
    schema: 'meridian-draft/v1' as const, feature: 'component' as const, id, baseToken,
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + draftWeek).toISOString(),
    payload: { step, definitionId, definitionVersion, definitionHash, parameters: Object.fromEntries(entries),
      destination: { mode: destination.mode, targetProjectId: destination.targetProjectId }, connections: ports },
  };
}

export type ComponentCheckpoint = ReturnType<typeof componentCheckpoint>;

export function listComponentCheckpoints(db: IDBDatabase, projectId: string | null) {
  return listGuidedCheckpoints(db, value => {
    try {
      const record = value as ComponentCheckpoint;
      if (record?.feature !== 'component' || record.payload.destination.targetProjectId !== projectId) return undefined;
      const expected = componentCheckpoint(record.payload, record.baseToken, record.id, Date.parse(record.createdAt));
      return sameCheckpoint(record, expected) && draftBytes(expected) <= maxDraftBytes ? expected : undefined;
    } catch { return undefined; }
  });
}

export function saveComponentCheckpoint(db: IDBDatabase, draft: ComponentDraft, baseToken: BaseToken | null, previous?: ComponentCheckpoint) {
  const now = Date.now();
  const next = componentCheckpoint(draft, baseToken, previous?.id ?? crypto.randomUUID(), now);
  return saveGuidedCheckpoint(db, next, previous, now);
}
