import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { openWorkspaceDatabase, readWorkspaceProject } from "../lib/persistence/workspace-db";
import {
  migrateWorkspace,
  readMigrationBackup,
  reviewWorkspaceMigration,
  type MigrationManifest,
} from "../lib/persistence/workspace-migration";
import { downloadText, LEGACY_STORAGE_KEY, safeFilename, serializeProject, STORAGE_KEY } from "../lib/storage";

type MigrationReview = Awaited<ReturnType<typeof reviewWorkspaceMigration>>;
type ProjectSummary = { id: string; title: string; available: boolean };
type Task = "inspect" | "prepare" | "download";

const quarantineReasons: Record<MigrationManifest["quarantined"][number]["reason"], string> = {
  format: "The project data could not be read.",
  source: "The diagram could not be verified.",
  size: "The converted project would exceed its file size limit.",
  annotations: "The converted project would exceed its annotation limits.",
  metadata: "The project's settings or presentation could not be converted.",
  identity: "The diagram's element identities could not be verified.",
};

export default function WorkspaceMigrationReview({ onClose, onDownloadLegacy }: {
  onClose: () => void;
  onDownloadLegacy: () => void;
}) {
  const action = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<Task | null>("inspect");
  const [review, setReview] = useState<MigrationReview>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const run = useCallback(async (task: Task, work: (db: IDBDatabase, signal: AbortSignal) => Promise<void>) => {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(task);
    setError("");
    setMessage("");
    let db: IDBDatabase | undefined;
    try {
      db = await openWorkspaceDatabase();
      controller.signal.throwIfAborted();
      await work(db, controller.signal);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "The workspace could not be accessed.");
      }
    } finally {
      db?.close();
      if (action.current === controller) {
        action.current = null;
        setBusy(null);
      }
    }
  }, []);

  const refresh = useCallback(async (db: IDBDatabase, signal: AbortSignal) => {
    const result = await reviewWorkspaceMigration(db);
    const summaries: ProjectSummary[] = [];
    for (const [index, { projectId }] of (result?.manifest.documents ?? []).entries()) {
      signal.throwIfAborted();
      const stored = await readWorkspaceProject(db, projectId).catch(() => undefined);
      summaries.push({
        id: projectId,
        title: stored?.document.title || (stored ? "Untitled diagram" : `Migrated project ${index + 1}`),
        available: !!stored,
      });
    }
    signal.throwIfAborted();
    setReview(result);
    setProjects(summaries);
  }, []);

  useEffect(() => {
    void run("inspect", refresh);
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY || event.key === LEGACY_STORAGE_KEY) {
        void run("inspect", refresh);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      action.current?.abort();
      action.current = null;
    };
  }, [refresh, run]);

  const manifest = review?.manifest;
  return (
    <Modal title="Project migration and recovery" wide onClose={onClose} busy={busy === "prepare"}>
      <p className="modal-intro">Prepare v3 copies of the projects saved in this browser. Your workspace stays available for editing.</p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {busy === "inspect" && <p role="status">Checking for saved copies…</p>}
      {busy === "prepare" && <p role="status">Checking and copying projects…</p>}
      {manifest && (
        <>
          <p>{manifest.counts.migrated} copied · {manifest.counts.quarantined} need recovery</p>
          {review.changed === true && (
            <p role="status">An older workspace changed after these copies were prepared. You can download both versions separately.</p>
          )}
          {review.changed === null && <p role="status">The current legacy workspace could not be checked.</p>}
          {projects.length > 0 && (
            <ul className="project-list">
              {projects.map(project => (
                <li className="project-row" key={project.id}>
                  <span>{project.title}</span>
                  <button className="button quiet" disabled={!!busy || !project.available}
                    aria-label={`Download v3 copy of ${project.title}`}
                    onClick={() => void run("download", async (db, signal) => {
                      const stored = await readWorkspaceProject(db, project.id);
                      signal.throwIfAborted();
                      if (!stored) throw new Error("The saved copy could not be found.");
                      downloadText(serializeProject(stored.document), `${safeFilename(stored.document.title)}.meridian.json`);
                    })}>
                    {project.available ? "Download v3 copy" : "Copy unavailable"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {manifest.quarantined.length > 0 && (
            <ul>
              {manifest.quarantined.map(item => (
                <li key={item.index}>Project {item.index + 1} in the backup. {quarantineReasons[item.reason]}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="recovery-actions">
        <button className="button secondary" disabled={!!busy} onClick={onDownloadLegacy}>
          Download current legacy workspace
        </button>
        {manifest && (
          <button className="button secondary" disabled={!!busy}
            onClick={() => void run("download", async (db, signal) => {
              const raw = await readMigrationBackup(db);
              signal.throwIfAborted();
              downloadText(raw, "meridian-pre-migration-workspace.json");
            })}>
            Download pre-migration backup
          </button>
        )}
        {!manifest && (
          <button className="button primary" disabled={!!busy}
            onClick={() => void run("prepare", async (db, signal) => {
              const result = await migrateWorkspace(db, localStorage, signal);
              setBusy("inspect");
              await refresh(db, signal);
              if (result.status === "empty") setMessage("There is no saved workspace to copy.");
            })}>
            Prepare v3 copies
          </button>
        )}
        {busy === "prepare" && (
          <button className="button quiet" onClick={() => action.current?.abort()}>Cancel preparation</button>
        )}
      </div>
    </Modal>
  );
}
