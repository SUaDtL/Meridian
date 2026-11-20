import { digestPattern, pendingAssistKey, requestIdPattern, type PendingAssistRequest } from '../authoring/assist-exchange';
import { elementUuidPattern } from '../authoring/identities';
import common from '../authoring/schemas/common.schema.json';
import { matchesBundledContract } from '../authoring/validate-mermaid-project';

export const pendingAssistStore = 'pendingAssist';
const limit = 20;
const maxRecordBytes = 32 * 1024;
const encoder = new TextEncoder();

export function validPendingAssist(value: unknown): value is PendingAssistRequest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PendingAssistRequest>;
  const ids = (input: unknown, max: number): input is string[] =>
    Array.isArray(input) && input.length <= max && new Set(input).size === input.length
      && input.every(id => typeof id === 'string' && elementUuidPattern.test(id));
  const scope = item.scope;
  if (typeof item.id !== 'string' || !requestIdPattern.test(item.id)
    || typeof item.requestHash !== 'string' || !digestPattern.test(item.requestHash)
    || !matchesBundledContract(item.baseToken, common.$defs.BaseToken)
    || !Number.isSafeInteger(item.expiresAt) || !scope || !ids(scope.readContextIds, 320)
    || !ids(scope.writableElementIds, 320) || !ids(scope.attachmentPointIds, 0)
    || !scope.writableElementIds.length || !scope.writableElementIds.every(id => scope.readContextIds.includes(id))
    || !Array.isArray(item.allowedOperations) || item.allowedOperations.length !== 1 || item.allowedOperations[0] !== 'setNodeLabel') {
    return false;
  }
  try {
    const encoded = pendingAssistKey({
      id: item.id, requestHash: item.requestHash, baseToken: item.baseToken!,
      expiresAt: item.expiresAt!, allowedOperations: item.allowedOperations,
      scope: {
        readContextIds: scope.readContextIds, writableElementIds: scope.writableElementIds, attachmentPointIds: scope.attachmentPointIds,
      },
    });
    return encoder.encode(encoded).byteLength <= maxRecordBytes && encoded === pendingAssistKey(item as PendingAssistRequest);
  } catch {
    return false;
  }
}

export const inactiveAssist = () => new Error('This suggestion no longer matches a live request. Export a fresh request.');

export function savePendingAssist(db: IDBDatabase, record: PendingAssistRequest) {
  return updatePendingAssist(db, record);
}

export function cleanPendingAssist(db: IDBDatabase) {
  return updatePendingAssist(db);
}

function updatePendingAssist(db: IDBDatabase, record?: PendingAssistRequest) {
  const now = Date.now();
  if (record && (!validPendingAssist(record) || record.expiresAt <= now)) return Promise.reject(inactiveAssist());
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(pendingAssistStore, 'readwrite');
    const store = tx.objectStore(pendingAssistStore);
    let failure: Error | undefined;
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Meridian could not save the local request record.'));
    const cursor = store.openCursor();
    let live = 0;
    cursor.onsuccess = () => {
      const position = cursor.result;
      if (position) {
        if (!validPendingAssist(position.value) || position.value.expiresAt <= now) position.delete();
        else live++;
        position.continue();
        return;
      }
      if (!record) return;
      if (live >= limit) {
        failure = new Error('This browser already has 20 pending requests. Apply one or wait for a request to expire.');
        tx.abort();
      } else store.add(record);
    };
  });
}

export function readPendingAssist(db: IDBDatabase, id: string) {
  return new Promise<PendingAssistRequest>((resolve, reject) => {
    const tx = db.transaction(pendingAssistStore, 'readwrite');
    const store = tx.objectStore(pendingAssistStore);
    let found: PendingAssistRequest | undefined;
    const read = store.get(id);
    read.onsuccess = () => {
      const result = read.result;
      if (validPendingAssist(result) && result.expiresAt > Date.now()) found = result;
      else if (result) store.delete(id);
    };
    tx.oncomplete = () => found ? resolve(found) : reject(inactiveAssist());
    tx.onabort = () => reject(tx.error ?? inactiveAssist());
  });
}
