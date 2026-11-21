import { canonicalJson } from '../authoring/base-token';
import { elementUuidPattern } from '../authoring/identities';

const storeName = 'drafts';
const maxDrafts = 10;
const maxTotalBytes = 10_000_000;
const encoder = new TextEncoder();
export const draftWeek = 7 * 24 * 60 * 60 * 1_000;
export const maxDraftBytes = 2_000_000;
export const draftBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
export const sameCheckpoint = (value: unknown, expected: unknown) => value !== undefined && canonicalJson(value) === canonicalJson(expected);

type GuidedRecord = { id: string; createdAt: string; expiresAt: string };

function expiredGuidedDraft(record: Record<string, unknown>, now: number) {
  if (record?.schema !== 'meridian-draft/v1' || typeof record.id !== 'string'
    || !elementUuidPattern.test(record.id) || typeof record.createdAt !== 'string'
    || typeof record.expiresAt !== 'string' || !record.payload || typeof record.payload !== 'object') return false;
  const guided = record.baseToken === null && record.feature === 'guided' && 'intent' in record.payload
    && (record.payload.intent === 'process' || record.payload.intent === 'systems');
  const chart = record.baseToken === null && record.feature === 'chart' && 'step' in record.payload && record.payload.step === 'mapping';
  const token = record.baseToken as { projectId?: unknown; revision?: unknown; contentHash?: unknown; stateDigest?: unknown } | null;
  const validToken = typeof token?.projectId === 'string' && elementUuidPattern.test(token.projectId)
    && typeof token.revision === 'number' && Number.isSafeInteger(token.revision) && token.revision >= 0
    && typeof token.contentHash === 'string' && /^[a-f0-9]{64}$/.test(token.contentHash)
    && typeof token.stateDigest === 'string' && /^[a-f0-9]{64}$/.test(token.stateDigest);
  const story = record.feature === 'story' && validToken && 'strategy' in record.payload
    && (record.payload.strategy === 'groups' || record.payload.strategy === 'paths');
  const component = record.feature === 'component' && (token === null || validToken) && 'definitionId' in record.payload
    && typeof record.payload.definitionId === 'string' && elementUuidPattern.test(record.payload.definitionId);
  const engineering = token === null && record.feature === 'engineering-facts' && 'adapter' in record.payload
    && record.payload.adapter === 'openapi' && 'step' in record.payload && record.payload.step === 'scope';
  if (!guided && !chart && !story && !component && !engineering) return false;
  const created = Date.parse(record.createdAt);
  const expires = Date.parse(record.expiresAt);
  return expires <= now && expires - created === draftWeek;
}

export function listGuidedCheckpoints<Draft extends GuidedRecord>(db: IDBDatabase, decode: (value: unknown) => Draft | undefined): Promise<Draft[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName);
    const read = tx.objectStore(storeName).getAll(undefined, maxDrafts + 1);
    tx.oncomplete = () => {
      if (read.result.length > maxDrafts) {
        reject(new Error('The local draft list exceeds its limit.'));
        return;
      }
      resolve(read.result.flatMap(value => {
        const record = decode(value);
        return record && Date.parse(record.expiresAt) > Date.now() ? [record] : [];
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    };
    tx.onabort = () => reject(tx.error ?? new Error('Local drafts could not be read.'));
  });
}

export async function saveGuidedCheckpoint<Draft extends GuidedRecord>(db: IDBDatabase, next: Draft, previous: Draft | undefined, now: number) {
  const size = draftBytes(next);
  if (size > maxDraftBytes) throw new Error('This draft is too large to save.');
  return new Promise<Draft>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    let failure: unknown;
    const read = store.getAll(undefined, maxDrafts + 1);
    tx.oncomplete = () => resolve(next);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The draft could not be saved.'));
    read.onsuccess = () => {
      try {
        const records = read.result;
        const current = records.find(record => record?.id === next.id);
        if (previous ? !sameCheckpoint(current, previous) : current !== undefined) {
          throw new Error('This draft changed in another tab. Reopen it before saving.');
        }
        const retained = records.filter(record => {
          if (record?.id === next.id) return false;
          if (!expiredGuidedDraft(record, now)) return true;
          store.delete(record.id);
          return false;
        });
        const total = retained.reduce((bytes, record) => bytes + draftBytes(record), size);
        if (records.length > maxDrafts || retained.length >= maxDrafts || total > maxTotalBytes) {
          throw new Error('Local drafts have reached their storage limit.');
        }
        store.put(next);
      } catch (reason) {
        failure = reason;
        tx.abort();
      }
    };
  });
}

export function discardGuidedCheckpoint(db: IDBDatabase, expected: GuidedRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const read = store.get(expected.id);
    let failure: unknown;
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('The draft could not be cleared.'));
    read.onsuccess = () => {
      try {
        if (read.result === undefined) return;
        if (!sameCheckpoint(read.result, expected)) throw new Error('This draft changed in another tab.');
        store.delete(expected.id);
      } catch (reason) {
        failure = reason;
        tx.abort();
      }
    };
  });
}
