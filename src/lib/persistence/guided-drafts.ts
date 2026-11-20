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
  if (record?.schema !== 'meridian-draft/v1' || record.feature !== 'guided' || typeof record.id !== 'string'
    || !elementUuidPattern.test(record.id) || record.baseToken !== null || typeof record.createdAt !== 'string'
    || typeof record.expiresAt !== 'string' || !record.payload || typeof record.payload !== 'object'
    || !('intent' in record.payload) || (record.payload.intent !== 'process' && record.payload.intent !== 'systems')) return false;
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
