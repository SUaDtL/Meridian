import { pendingAssistKey, type PendingAssistRequest } from '../authoring/assist-exchange';
import { inactiveAssist, pendingAssistStore, validPendingAssist } from './pending-assist';
import { canonicalJson, projectBaseToken } from '../authoring/base-token';
import type { ChartProject } from '../authoring/chart-data';
import { validateChartProject } from '../authoring/chart-project';
import { elementUuidPattern } from '../authoring/identities';
import type { MermaidProjectV3 } from '../authoring/mermaid-project';
import { parseMermaidProject, validateMermaidProject } from '../authoring/validate-mermaid-project';
import type { ProjectOrigin } from "./project-inventory";
import { MAX_PROJECTS } from '../storage';

export interface SavedAnchor {
  storageGeneration: string;
  stateDigest: string;
}

type WorkspaceProject = MermaidProjectV3 | ChartProject;

export interface StoredProject<Project extends WorkspaceProject = MermaidProjectV3> {
  id: string;
  document: Project;
  anchor: SavedAnchor;
  origin?: ProjectOrigin;
}

const documentsStore = 'documents';
const componentDefinitionsStore = 'library';
const kindIndex = 'document-kind';
export { openWorkspaceDatabase } from './project-inventory';
const digestPattern = /^[a-f0-9]{64}$/;

export class StorageConflict extends Error {
  constructor() {
    super('This project changed in another tab. Review the saved version before retrying.');
    this.name = 'StorageConflict';
  }
}

function validateStoredProject(value: unknown, kind: WorkspaceProject['documentKind']): WorkspaceProject {
  if (kind === 'mermaid') return validateMermaidProject(value);
  return validateChartProject(value).project;
}

export async function captureProjectWrite<Project extends WorkspaceProject>(document: Project): Promise<StoredProject<Project>> {
  const snapshot = structuredClone(validateStoredProject(document, document?.documentKind === 'chart' ? 'chart' : 'mermaid')) as Project;
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

export function listWorkspaceProjectIds(db: IDBDatabase, kind: WorkspaceProject['documentKind'] = 'mermaid'): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(documentsStore);
    const request = tx.objectStore(documentsStore).index(kindIndex).getAllKeys(kind, MAX_PROJECTS + 1);
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
  return saveWorkspaceProjectCopy(db, parseMermaidProject(text), { kind: "import" });
}

export async function saveWorkspaceProjectCopy(db: IDBDatabase, original: MermaidProjectV3, origin?: ProjectOrigin): Promise<MermaidProjectV3> {
  const imported = { ...original, id: crypto.randomUUID(), revision: 0 };
  await writeWorkspaceProject(db, imported, null, undefined, origin);
  return imported;
}

/** Verify the payload against its durable anchor after the readonly transaction completes. */
export function readWorkspaceProject(db: IDBDatabase, id: string, kind?: 'mermaid'): Promise<StoredProject | undefined>;
export function readWorkspaceProject(db: IDBDatabase, id: string, kind: 'chart'): Promise<StoredProject<ChartProject> | undefined>;
export async function readWorkspaceProject(db: IDBDatabase, id: string, kind: WorkspaceProject['documentKind'] = 'mermaid'): Promise<StoredProject<WorkspaceProject> | undefined> {
  const stored = await new Promise<StoredProject<WorkspaceProject> | undefined>((resolve, reject) => {
    const tx = db.transaction(documentsStore);
    const request = tx.objectStore(documentsStore).get(id);
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error ?? new Error('Could not read the saved Meridian project.'));
  });
  if (stored === undefined) return undefined;
  const document = validateStoredProject(stored.document, kind);
  if (stored.id !== id || document.id !== id || !validAnchor(stored.anchor)) {
    throw new Error('Stored Meridian project information is invalid.');
  }
  const token = await projectBaseToken(document);
  if (token.stateDigest !== stored.anchor.stateDigest) {
    throw new Error('The saved Meridian project differs from its storage anchor.');
  }
  return { id, document, anchor: stored.anchor };
}

export type WorkspaceWriteGuard =
  | { kind: 'assist'; request: PendingAssistRequest }
  | { kind: 'component'; id: string; version: string; signature: string };

/** Compare the existing anchor and commit the exact capture in a single transaction. */
export async function writeWorkspaceProject(
  db: IDBDatabase,
  document: WorkspaceProject,
  expected: SavedAnchor | null,
  guard?: WorkspaceWriteGuard,
  origin?: ProjectOrigin,
): Promise<SavedAnchor> {
  if (expected !== null && !validAnchor(expected)) throw new Error('Invalid saved workspace anchor.');
  const expectedAnchor = expected && { ...expected };
  const record = await captureProjectWrite(document);
  const consumeAssist = guard?.kind === 'assist' ? guard.request : undefined;
  const component = guard?.kind === 'component' ? guard : undefined;
  if (component && !expectedAnchor) throw new Error('Save the target project before inserting the component.');
  if (consumeAssist && (consumeAssist.baseToken.projectId !== record.id || !expectedAnchor
    || consumeAssist.baseToken.stateDigest !== expectedAnchor.stateDigest
    || consumeAssist.baseToken.revision + 1 !== document.revision)) throw inactiveAssist();
  return new Promise((resolve, reject) => {
    const stores = [documentsStore];
    if (guard) stores.push(guard.kind === 'assist' ? pendingAssistStore : componentDefinitionsStore);
    const tx = db.transaction(stores, 'readwrite');
    const documents = tx.objectStore(documentsStore);
    let failure: Error | undefined;
    tx.oncomplete = () => resolve(record.anchor);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Meridian could not save the project.'));
    const read = documents.get(record.id);
    read.onsuccess = () => {
      const existing: StoredProject<WorkspaceProject> | undefined = read.result;
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
      if (existing?.origin || origin) record.origin = existing?.origin ?? origin;
      if (consumeAssist) {
        const pending = tx.objectStore(pendingAssistStore);
        const readPending = pending.get(consumeAssist.id);
        readPending.onsuccess = () => {
          const match = readPending.result;
          if (!validPendingAssist(match) || match.expiresAt <= Date.now()
            || pendingAssistKey(match) !== pendingAssistKey(consumeAssist)) {
            failure = inactiveAssist();
            tx.abort();
            return;
          }
          documents.put(record);
          pending.delete(consumeAssist.id);
        };
      } else if (component) {
        const library = tx.objectStore(componentDefinitionsStore);
        const definition = library.get([component.id, component.version]);
        definition.onsuccess = () => {
          try {
            if (!definition.result || canonicalJson(definition.result) !== component.signature) {
              throw new Error('The saved definition changed. Select the current definition and preview again.');
            }
            documents.put(record);
          } catch (reason) {
            failure = reason instanceof Error ? reason : new Error('The component definition could not be verified.');
            tx.abort();
          }
        };
      } else if (existing !== undefined) documents.put(record);
      else {
        const count = documents.count();
        count.onsuccess = () => {
          if (count.result >= MAX_PROJECTS) {
            failure = new Error(`Keep at most ${MAX_PROJECTS} workspace projects in this browser.`);
            tx.abort();
          } else documents.add(record);
        };
      }
    };
  });
}
