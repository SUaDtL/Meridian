import { useEffect, useState } from "react";
import type { StudioDocument, StudioSettings } from "../types";
import type { MermaidProjectV3 } from "../lib/authoring/mermaid-project";
import { openWorkspaceDatabase } from "../lib/persistence/project-inventory";
import { validateDocument, validateSettings } from "../lib/storage";
import Modal from "./Modal";

type Project = StudioDocument | MermaidProjectV3;
type Entry = { key: string; name: string; time: string; value: Project | StudioSettings };
export default function SavedVersions({ mode, project, onRestore, onStyle, onClose }: {
  mode: "checkpoints" | "styles"; project: Project;
  onRestore: (project: Project) => void; onStyle: (settings: StudioSettings) => void; onClose: () => void;
}) {
  const styles = mode === "styles";
  const prefix = styles ? "style/" : "checkpoint/" + project.schema + "/" + project.id + "/";
  const [entries, setEntries] = useState<Entry[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let current = true;
    void (async () => {
      const db = await openWorkspaceDatabase();
      try {
        const rows = await new Promise<Entry[]>((resolve, reject) => {
          const tx = db.transaction("metadata");
          const request = tx.objectStore("metadata").getAll(IDBKeyRange.bound(prefix, prefix + "\uffff"));
          tx.oncomplete = () => resolve(request.result);
          tx.onabort = () => reject(tx.error);
        });
        if (current) setEntries(rows.sort((a,b) => b.time.localeCompare(a.time)));
      } finally { db.close(); }
    })().catch(() => { if (current) setError("Saved versions could not be read in this browser."); });
    return () => { current = false; };
  }, [prefix, revision]);
  async function save() {
    const label = name.trim();
    if (!label || busy) return;
    setBusy(true); setError("");
    try {
      const db = await openWorkspaceDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("metadata", "readwrite");
          tx.objectStore("metadata").add({ key: prefix + crypto.randomUUID(), name: label, time: new Date().toISOString(),
            value: styles ? project.settings : project });
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
      setName(""); refresh(n => n + 1);
    } catch { setError("Could not save this version. Check the browser’s available storage."); }
    finally { setBusy(false); }
  }
  async function apply(entry: Entry) {
    setError("");
    try {
      if (styles) onStyle(validateSettings(entry.value));
      else {
        const value = project.schema === "meridian/v3"
          ? (await import("../lib/authoring/validate-mermaid-project")).validateMermaidProject(entry.value)
          : validateDocument(entry.value);
        if (value.id !== project.id || value.schema !== project.schema) throw new Error("This checkpoint belongs to another project.");
        onRestore(value);
      }
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to apply this version."); }
  }
  return <Modal title={styles ? "Style profiles" : "Named checkpoints"} busy={busy} onClose={onClose}>
    <p>{styles ? "Reuse this diagram’s typography, layout, frame, and effects. Individual element overrides stay in place." :
      "Save a version of this project in this browser. Restoring a checkpoint also creates an Undo entry."}</p>
    <form className="heading-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label>{styles ? "Profile name" : "Checkpoint name"}<input value={name} maxLength={80} onChange={e => setName(e.target.value)} /></label>
      <button className="button primary" disabled={!name.trim() || busy}>{styles ? "Save profile" : "Save checkpoint"}</button>
    </form>
    {error && <p role="alert">{error}</p>}
    <ul className="project-list">{entries.map(entry => <li className="project-row" key={entry.key}>
      <span><strong>{entry.name}</strong><small>{new Date(entry.time).toLocaleString()}</small></span>
      <button className="button secondary" disabled={busy} onClick={() => void apply(entry)}>{styles ? "Apply profile" : "Restore checkpoint"}</button>
    </li>)}</ul>
  </Modal>;
}
