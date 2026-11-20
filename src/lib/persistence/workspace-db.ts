import { projectBaseToken } from '../authoring/base-token';
import { elementUuidPattern } from '../authoring/identities';
import type { MermaidProjectV3 } from '../authoring/mermaid-project';
import { parseMermaidProject, validateMermaidProject } from '../authoring/validate-mermaid-project';
import { MAX_PROJECTS } from '../storage';

export interface SavedAnchor {
  storageGeneration: string;
  stateDigest: string;
}

export interface StoredProject {
  id: string;
  document: MermaidProjectV3;
  anchor: SavedAnchor;
}

const databaseName = 'meridian-workspace';
const databaseVersion = 1;
const documentsStore = 'documents';
const digestPattern = /^[a-f0-9]{64}$/;

export class StorageConflict extends Error {
  constructor() {
    super('This project changed in another tab. Review the saved version before retrying.');
    this.name = 'StorageConflict';
  }
}

export function openWorkspaceDatabase(factory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, databaseVersion);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close older Meridian tabs before preparing the workspace database.'));
    };
    request.onupgradeneeded = () => {
      if (blocked) {
        request.transaction?.abort();
        return;
      }
      const db = request.result;
      db.createObjectStore(documentsStore, { keyPath: 'id' });
      db.createObjectStore('datasets', { keyPath: 'digest' });
      db.createObjectStore('library', { keyPath: ['id', 'version'] });
      for (const name of ['drafts', 'pendingAssist']) db.createObjectStore(name, { keyPath: 'id' });
      for (const name of ['migrations', 'metadata', 'previews']) db.createObjectStore(name, { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error ?? new Error('Could not open Meridian workspace storage.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
  });
}

export async function captureProjectWrite(document: MermaidProjectV3): Promise<StoredProject> {
  const snapshot = structuredClone(validateMermaidProject(document));
  const token = await projectBaseToken(snapshot);
  return {
    id: snapshot.id,
    document: snapshot,
    anchor: { storageGeneration: crypto.randomUUID(), stateDigest: token.stateDigest },
  };
}

function validAnchor(value: unknown): value is SavedAnchor {
  if (!value || typeof value !== 'object') return false;
  const anchor = value as Partial<SavedAnchor>;
  return typeof anchor.storageGeneration === 'string' && elementUuidPattern.test(anchor.storageGeneration)
    && typeof anchor.stateDigest === 'string' && digestPattern.test(anchor.stateDigest);
}

function sameAnchor(left: SavedAnchor, right: SavedAnchor): boolean {
  return left.storageGeneration === right.storageGeneration && left.stateDigest === right.stateDigest;
}

export function listWorkspaceProjectIds(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(documentsStore);
    const request = tx.objectStore(documentsStore).getAllKeys(undefined, MAX_PROJECTS + 1);
    tx.oncomplete = () => {
      const keys = request.result;
      if (keys.length > MAX_PROJECTS || !keys.every(key => typeof key === 'string' && elementUuidPattern.test(key))) {
        reject(new Error('The saved Meridian project list is invalid.'));
        return;
      }
      resolve(keys as string[]);
    };
    tx.onabort = () => reject(tx.error ?? new Error('Could not read the saved Meridian projects.'));
  });
}

/** Import the portable document as a separate project, preserving authored state. */
export async function importWorkspaceProject(db: IDBDatabase, text: string): Promise<MermaidProjectV3> {
  const original = parseMermaidProject(text);
  const imported = { ...original, id: crypto.randomUUID(), revision: 0 };
  await writeWorkspaceProject(db, imported, null);
  return imported;
}

/** Verify the payload against its durable anchor after the readonly transaction completes. */
export async function readWorkspaceProject(db: IDBDatabase, id: string): Promise<StoredProject | undefined> {
  const stored = await new Promise<StoredProject | undefined>((resolve, reject) => {
    const tx = db.transaction(documentsStore);
    const request = tx.objectStore(documentsStore).get(id);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error('Could not read the saved Meridian project.'));
  });
  if (stored === undefined) return undefined;
  const document = validateMermaidProject(stored.document);
  if (stored.id !== id || document.id !== id || !validAnchor(stored.anchor)) {
    throw new Error('Stored Meridian project information is invalid.');
  }
  const token = await projectBaseToken(document);
  if (token.stateDigest !== stored.anchor.stateDigest) {
    throw new Error('The saved Meridian project differs from its storage anchor.');
  }
  return { id, document, anchor: stored.anchor };
}

/** Compare the existing anchor and commit the exact capture in a single transaction. */
export async function writeWorkspaceProject(
  db: IDBDatabase,
  document: MermaidProjectV3,
  expected: SavedAnchor | null,
): Promise<SavedAnchor> {
  if (expected !== null && !validAnchor(expected)) throw new Error('Invalid saved workspace anchor.');
  const expectedAnchor = expected && { ...expected };
  const record = await captureProjectWrite(document);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(documentsStore, 'readwrite');
    const documents = tx.objectStore(documentsStore);
    let failure: Error | undefined;
    tx.oncomplete = () => resolve(record.anchor);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Meridian could not save the project.'));
    const read = documents.get(record.id);
    read.onsuccess = () => {
      const existing: StoredProject | undefined = read.result;
      if (existing !== undefined && (!validAnchor(existing?.anchor) || existing.id !== record.id)) {
        failure = new Error('Stored Meridian project information is invalid. Download a copy before recovery.');
        tx.abort();
        return;
      }
      if ((existing === undefined && expectedAnchor !== null)
        || (existing !== undefined && (expectedAnchor === null || !sameAnchor(existing.anchor, expectedAnchor)))) {
        failure = new StorageConflict();
        tx.abort();
        return;
      }
      if (existing !== undefined) documents.put(record);
      else {
        const count = documents.count();
        count.onsuccess = () => {
          if (count.result >= MAX_PROJECTS) {
            failure = new Error(`Keep at most ${MAX_PROJECTS} v3 projects in this browser.`);
            tx.abort();
          } else documents.add(record);
        };
      }
    };
  });
}
