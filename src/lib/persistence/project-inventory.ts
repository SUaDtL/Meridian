import type { StudioDocument, ThemeId } from "../../types";

export type ProjectOrigin = { kind: "import" } | { kind: "upgrade"; sourceId: string; updatedAt: string };
export interface ProjectListItem {
  id: string;
  kind: "diagram" | "mermaid" | "chart";
  title: string;
  subtitle: string;
  theme: ThemeId;
  updatedAt: string;
  sceneCount: number;
  origin?: ProjectOrigin;
}
export function studioListItem(doc: StudioDocument): ProjectListItem {
  return { id: doc.id, kind: "diagram", title: doc.title, subtitle: doc.subtitle, theme: doc.settings.theme,
    updatedAt: doc.updatedAt, sceneCount: doc.storyboard?.scenes.length ?? 0 };
}

const databaseName = 'meridian-workspace';
const databaseVersion = 2;
const documentsStore = 'documents';
const componentDefinitionsStore = 'library';
const kindIndex = 'document-kind';
export function openWorkspaceDatabase(factory = indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, databaseVersion);
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Close older Meridian tabs before preparing the workspace database.'));
    };
    request.onupgradeneeded = event => {
      if (blocked) {
        request.transaction?.abort();
        return;
      }
      const db = request.result;
      if (event.oldVersion === 0) {
        db.createObjectStore(documentsStore, { keyPath: 'id' });
        db.createObjectStore('datasets', { keyPath: 'digest' });
        db.createObjectStore(componentDefinitionsStore, { keyPath: ['id', 'version'] });
        for (const name of ['drafts', 'pendingAssist']) db.createObjectStore(name, { keyPath: 'id' });
        for (const name of ['migrations', 'metadata', 'previews']) db.createObjectStore(name, { keyPath: 'key' });
      }
      request.transaction!.objectStore(documentsStore).createIndex(kindIndex, 'document.documentKind');
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

export async function listStoredProjects(): Promise<ProjectListItem[]> {
  const db = await openWorkspaceDatabase();
  try {
    return await new Promise<ProjectListItem[]>((resolve, reject) => {
      const items: ProjectListItem[] = [];
      const tx = db.transaction(documentsStore);
      const cursor = tx.objectStore(documentsStore).openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const doc = row.value.document;
        if (doc?.documentKind === "mermaid" || doc?.documentKind === "chart") {
          items.push({ id: doc.documentKind + "/" + row.primaryKey, kind: doc.documentKind,
            origin: row.value.origin,
            title: String(doc.title || "Untitled project") + (row.value.origin?.kind === "import" ? " (imported)" : ""), subtitle: String(doc.subtitle ?? ""),
            updatedAt: String(doc.updatedAt ?? ""), theme: doc.settings?.theme ?? doc.frame?.theme ?? "obsidian",
            sceneCount: doc.storyboard?.scenes?.length ?? 0 });
        }
        row.continue();
      };
      tx.oncomplete = () => resolve(items);
      tx.onabort = () => reject(tx.error ?? new Error("Could not list saved projects."));
    });
  } finally { db.close(); }
}
