import { canonicalJson } from '../authoring/base-token';
import { encodeMermaidLabel, authoringLimits } from '../authoring/flowchart-source';
import type { ProcessStep } from '../authoring/guided-process';
import { elementUuidPattern } from '../authoring/identities';

const storeName = 'drafts';
const week = 7 * 24 * 60 * 60 * 1_000;
const maxDrafts = 10;
const maxDraftBytes = 2_000_000;
const maxTotalBytes = 10_000_000;
const encoder = new TextEncoder();

function makeCheckpoint(title: string, steps: readonly ProcessStep[], id: string, timestamp: number) {
  if (!Number.isFinite(timestamp) || typeof id !== 'string' || !elementUuidPattern.test(id)
    || typeof title !== 'string' || title.length > 120 || /[\uD800-\uDFFF]/u.test(title)
    || !steps.length || steps.length > authoringLimits.graphNodes) throw new Error('This draft cannot be saved.');
  let previousLine = 0;
  const nodes = steps.map(({ line, label }, index) => {
    if (!Number.isSafeInteger(line) || line <= previousLine || line > authoringLimits.sourceCodeUnits + 1) {
      throw new Error('The draft row order is invalid.');
    }
    previousLine = line;
    encodeMermaidLabel(label);
    return { id: `step-${index + 1}`, label, role: null, shape: 'rect' as const, sourceRow: line };
  });
  return {
    schema: 'meridian-draft/v1' as const,
    id,
    feature: 'guided' as const,
    baseToken: null,
    createdAt: new Date(timestamp).toISOString(),
    expiresAt: new Date(timestamp + week).toISOString(),
    payload: {
      intent: 'process' as const, mode: 'linear' as const, step: 'connections' as const,
      title, subtitle: '', direction: 'LR' as const,
      destination: { mode: 'new' as const, targetProjectId: null },
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        id: `connection-${index + 1}`, sourceId: nodes[index].id, targetId: node.id,
        label: '', direction: 'forward' as const, review: 'accepted' as const,
      })),
      groups: [],
      terminalNodeIds: [],
      mapping: { id: null, label: null, source: null, target: null, role: null },
    },
  };
}

export type ProcessCheckpoint = ReturnType<typeof makeCheckpoint>;
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
const sameCheckpoint = (value: unknown, expected: ProcessCheckpoint) => value !== undefined && canonicalJson(value) === canonicalJson(expected);

function readCheckpoint(value: unknown): ProcessCheckpoint | undefined {
  try {
    const record = value as ProcessCheckpoint;
    if (record?.feature !== 'guided' || record.payload?.mode !== 'linear') return undefined;
    const normalized = record.payload.nodes.map(node => ({ line: node.sourceRow, original: node.label, label: node.label }));
    const expected = makeCheckpoint(record.payload.title, normalized, record.id, Date.parse(record.createdAt));
    return sameCheckpoint(record, expected) && bytes(expected) <= maxDraftBytes ? expected : undefined;
  } catch {
    return undefined;
  }
}

export function listProcessCheckpoints(db: IDBDatabase): Promise<ProcessCheckpoint[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName);
    const read = tx.objectStore(storeName).getAll(undefined, maxDrafts + 1);
    tx.oncomplete = () => {
      if (read.result.length > maxDrafts) {
        reject(new Error('The local draft list exceeds its limit.'));
        return;
      }
      resolve(read.result.flatMap(value => {
        const record = readCheckpoint(value);
        return record && Date.parse(record.expiresAt) > Date.now() ? [record] : [];
      }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    };
    tx.onabort = () => reject(tx.error ?? new Error('Local drafts could not be read.'));
  });
}

export async function saveProcessCheckpoint(
  db: IDBDatabase, title: string, steps: readonly ProcessStep[], previous?: ProcessCheckpoint,
): Promise<ProcessCheckpoint> {
  const now = Date.now();
  const next = makeCheckpoint(title, steps, previous?.id ?? crypto.randomUUID(), now);
  if (bytes(next) > maxDraftBytes) throw new Error('This draft is too large to save.');
  return new Promise((resolve, reject) => {
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
          const checkpoint = readCheckpoint(record);
          if (checkpoint && Date.parse(checkpoint.expiresAt) <= now) {
            store.delete(checkpoint.id);
            return false;
          }
          return true;
        });
        const total = retained.reduce((size, record) => size + bytes(record), bytes(next));
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

export function discardProcessCheckpoint(db: IDBDatabase, expected: ProcessCheckpoint): Promise<void> {
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
