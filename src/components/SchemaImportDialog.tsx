import { useEffect, useRef, useState } from "react";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import SchemaWorker from "../lib/authoring/schema-import.worker?worker&inline";
import type { SchemaFacts } from "../lib/authoring/schema-facts";
import { validateVirtualPath } from "../lib/authoring/openapi-facts";
import { prepareSchemaProject, schemaScope } from "../lib/authoring/schema-project";
import { buildExportFrame } from "../lib/export";
import { discardGuidedCheckpoint } from "../lib/persistence/guided-drafts";
import { listSchemaCheckpoints, restoreSchemaScope, saveSchemaCheckpoint, type SchemaCheckpoint } from "../lib/persistence/schema-drafts";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import Modal from "./Modal";

type FileMapping = { file: File; path: string };
type Preview = Awaited<ReturnType<typeof prepareSchemaProject>> & { url: string };
const chunkSize = 40;
const saveLabel = "Saving the schema diagram";
const saveScopeLabel = "Saving the schema scope";
const discardScopeLabel = "Discarding the schema scope";

export default function SchemaImportDialog({ onBack, onClose, onCreated }: {
  onBack: () => void; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [files, setFiles] = useState<FileMapping[]>([]);
  const [facts, setFacts] = useState<SchemaFacts>();
  const [selected, setSelected] = useState(new Map<string, string>());
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(chunkSize);
  const [includeUnresolved, setIncludeUnresolved] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);
  const [checkpoints, setCheckpoints] = useState<SchemaCheckpoint[]>([]);
  const [checkpoint, setCheckpoint] = useState<SchemaCheckpoint>();
  const [restored, setRestored] = useState(false);
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    let active = true;
    void openWorkspaceDatabase().then(async db => {
      try {
        const saved = await listSchemaCheckpoints(db);
        if (active) setCheckpoints(saved);
      } finally { db.close(); }
    }).catch(() => { if (active) setNotice("Saved schema scopes are unavailable."); });
    return () => { active = false; };
  }, []);

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>, canRetry = false) {
    if (controller.current) return;
    const work = new AbortController();
    controller.current = work;
    setBusy(label);
    setError("");
    setNotice("");
    setRetry(false);
    try {
      await action(work.signal);
    } catch (reason) {
      if (!work.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "The JSON Schema import could not continue.");
        setRetry(canRetry && reason instanceof AuthoringWorkerTimeout);
      }
    } finally {
      controller.current = null;
      if (!work.signal.aborted) setBusy("");
    }
  }

  function read(extended = false) {
    void run("Reading JSON Schema facts", async signal => {
      if (!files.length || files.length > 20 || files.reduce((sum, item) => sum + item.file.size, 0) > 2_000_000) {
        throw new Error("Choose up to 20 JSON Schema files totaling at most 2,000,000 bytes.");
      }
      const paths = files.map(item => validateVirtualPath(item.path));
      if (new Set(paths).size !== paths.length) throw new Error("Assign a distinct virtual path to every schema file.");
      const inputs = await Promise.all(files.map(async (item, index) => ({ virtualPath: paths[index], bytes: await item.file.arrayBuffer() })));
      const result = await runAuthoringWorker<SchemaFacts>(() => new SchemaWorker(), { files: inputs }, signal, "Reading JSON Schema facts", extended);
      signal.throwIfAborted();
      setFiles([]);
      setSelected(new Map());
      setQuery("");
      setLimit(chunkSize);
      setIncludeUnresolved(false);
      setCheckpoint(undefined);
      setRestored(false);
      setFacts(result);
    }, !extended);
  }

  function resume(saved: SchemaCheckpoint) {
    const scope = restoreSchemaScope(saved);
    setFiles([]);
    setSelected(new Map(scope.selection));
    setQuery("");
    setLimit(chunkSize);
    setIncludeUnresolved(scope.includeUnresolved);
    setCheckpoint(saved);
    setRestored(true);
    setError("");
    setRetry(false);
    setNotice("");
    setFacts(scope.facts);
  }

  function saveScope(destination?: "close" | "files") {
    if (!facts) return;
    void run(saveScopeLabel, async signal => {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        const saved = await saveSchemaCheckpoint(db, { facts, selection: selected, includeUnresolved }, checkpoint);
        setCheckpoints(items => [saved, ...items.filter(item => item.id !== saved.id)]);
        setCheckpoint(saved);
        setNotice("Schema facts and scope saved in this browser.");
        if (destination === "files") setFacts(undefined);
        if (destination === "close") onClose();
      } finally { db.close(); }
    });
  }

  function discard(saved: SchemaCheckpoint, close = false) {
    void run(discardScopeLabel, async signal => {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        await discardGuidedCheckpoint(db, saved);
        setCheckpoints(items => items.filter(item => item.id !== saved.id));
        if (checkpoint?.id === saved.id) setCheckpoint(undefined);
        if (close) onClose();
      } finally { db.close(); }
    });
  }

  function close() {
    if (facts && (selected.size || checkpoint) && !busy) saveScope("close");
    else onClose();
  }

  function review() {
    if (!facts) return;
    void run("Rendering the proposed schema diagram", async signal => {
      const result = await prepareSchemaProject(facts, selected, includeUnresolved, signal);
      signal.throwIfAborted();
      const svg = buildExportFrame(result.rendered, result.document).svg;
      setPainted(false);
      setPreview({ ...result, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    });
  }

  function create() {
    if (!preview || !painted) return;
    void run(saveLabel, async signal => {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        await writeWorkspaceProject(db, preview.document, null);
        if (checkpoint) await discardGuidedCheckpoint(db, checkpoint).catch(() => undefined);
        onCreated(preview.document.id);
      } finally {
        db.close();
      }
    });
  }

  function updateSelection(key: string, label: string | null) {
    setSelected(previous => {
      const next = new Map(previous);
      if (label === null) next.delete(key);
      else next.set(key, label);
      return next;
    });
  }

  const scope = facts && schemaScope(facts, selected, includeUnresolved);
  const search = query.trim().toLowerCase();
  const visibleMatches = facts?.facts.filter(item =>
    item.label.toLowerCase().includes(search) || item.virtualPath.toLowerCase().includes(search)) ?? [];
  const visible = visibleMatches.slice(0, limit);
  const hidden = selected.size - visible.filter(item => selected.has(item.key)).length;
  const tooLarge = !!scope && (scope.nodes.length > 100 || scope.links.length > 200);
  const needsLabel = Array.from(selected.values()).some(label => !label.trim() || [...label].length > 200);
  return <Modal title="JSON Schema relationships" wide busy={[saveLabel, saveScopeLabel, discardScopeLabel].includes(busy)} onClose={close}>
    {!facts && <form className="heading-form" onSubmit={event => { event.preventDefault(); read(); }}>
      <p>Choose draft 2020-12 JSON Schema files. Meridian reads them locally and looks for references among the files you select.</p>
      {!!checkpoints.length && <ul className="project-list" aria-label="Saved JSON Schema scopes">
        {checkpoints.map(item => <li className="project-row" key={item.id}>
          <button type="button" className="project-open" disabled={!!busy} onClick={() => resume(item)}>
            <strong>Resume {item.payload.virtualPaths[0] ?? "schema scope"}</strong>
            <small>{item.payload.selectedFactIds.length} selected facts · {new Date(item.createdAt).toLocaleString()}</small>
          </button>
          <button type="button" className="button quiet" disabled={!!busy} onClick={() => discard(item)}>Discard scope draft</button>
        </li>)}
      </ul>}
      <label>JSON Schema files<input type="file" multiple accept=".json,application/json,application/schema+json" disabled={!!busy} onChange={event => {
        setError("");
        setRetry(false);
        const chosen = event.target.files;
        if (chosen && (chosen.length > 20 || Array.from(chosen).reduce((sum, file) => sum + file.size, 0) > 2_000_000)) {
          event.target.value = "";
          setFiles([]);
          setError("Choose up to 20 JSON Schema files totaling at most 2,000,000 bytes.");
          return;
        }
        setFiles(Array.from(chosen ?? [], file => ({
          file, path: (file.webkitRelativePath || file.name).replace(/[^A-Za-z0-9_./-]/g, "_"),
        })));
      }} /></label>
      {files.length > 0 && <fieldset>
        <legend>Review virtual file paths</legend>
        {files.map((item, index) => <label key={index}>{item.file.name}
          <input aria-label={`Virtual path for file ${index + 1}`} value={item.path} maxLength={200} disabled={!!busy}
            onChange={event => setFiles(previous => previous.map((entry, itemIndex) =>
              itemIndex === index ? { ...entry, path: event.target.value } : entry))} />
        </label>)}
      </fieldset>}
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={onBack}>Back</button>
        <button type="submit" className="button primary" disabled={!!busy || !files.length}>Read schema facts</button>
      </div>
    </form>}
    {facts && !preview && <div className="heading-form">
      {restored ? <p>Resumed scope · {facts.unresolved.length} unresolved {facts.unresolved.length === 1 ? "entry" : "entries"}</p>
        : <p>{facts.checkedReferences} ordinary references checked · {facts.unresolved.length} unresolved {facts.unresolved.length === 1 ? "entry" : "entries"} · {facts.compositionCount} locations with composition or conditionals</p>}
      <p>Properties and references are drawn as declared. Composition, conditionals and dynamic reference semantics are outside this view.</p>
      <label>Find schema facts<input value={query} maxLength={200} disabled={!!busy}
        onChange={event => { setQuery(event.target.value); setLimit(chunkSize); }} /></label>
      <p role="status">{selected.size} selected facts · {hidden} outside visible rows · {scope?.nodes.length} diagram nodes · {scope?.links.length} connections</p>
      {!visible.length && <p>No schema facts match this view.</p>}
      <ul className="project-list">
        {visible.map(item => <li className="project-row" key={item.key}>
          <label><input type="checkbox" checked={selected.has(item.key)} disabled={!!busy}
            onChange={event => updateSelection(item.key, event.target.checked ? item.label : null)} />
            {item.label || "Empty property name"}
          </label>
          <small>{item.required ? "Required property" : item.kind} · {item.virtualPath}{item.pointer || " (root)"}</small>
          {selected.has(item.key) && <label>Diagram label<input value={selected.get(item.key)} disabled={!!busy}
            onChange={event => updateSelection(item.key, event.target.value)} /></label>}
        </li>)}
      </ul>
      {visibleMatches.length > limit && <button type="button" className="button quiet" disabled={!!busy}
        onClick={() => setLimit(value => value + chunkSize)}>Show more facts</button>}
      {!!scope?.unresolved.length && <fieldset>
        <legend>{scope.unresolved.length} unresolved entries for selected facts</legend>
        <label className="check-label"><input type="checkbox" checked={includeUnresolved} disabled={!!busy}
          onChange={event => setIncludeUnresolved(event.target.checked)} /> Include labeled placeholders in the diagram</label>
        <details><summary>See unresolved locations</summary>
          <ul>{scope.unresolved.slice(0, 100).map(item => <li key={item.virtualPath + "#" + item.pointer}>
            {item.virtualPath}{item.pointer} · {item.reason}
          </li>)}</ul>
          {scope.unresolved.length > 100 && <p>Refine the selected scope to see all unresolved locations.</p>}
        </details>
      </fieldset>}
      {needsLabel && <p>Give each selected fact a display label of 1 to 200 characters.</p>}
      {tooLarge && <p>Choose a scope with at most 100 nodes and 200 connections.</p>}
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy}
          onClick={() => selected.size || checkpoint ? saveScope("files") : setFacts(undefined)}>Choose other files</button>
        <button type="button" className="button quiet" disabled={!!busy}
          onClick={() => checkpoint ? discard(checkpoint, true) : onClose()}>Discard this scope</button>
        <button type="button" className="button secondary" disabled={!!busy || !selected.size || tooLarge || needsLabel}
          onClick={() => saveScope()}>Save scope draft</button>
        <button type="button" className="button primary" disabled={!!busy || !selected.size || tooLarge || needsLabel}
          onClick={review}>Preview schema diagram</button>
      </div>
    </div>}
    {preview && <section className="migration-preview" aria-label="Proposed JSON Schema diagram">
      <p>{scope?.nodes.length} nodes · {scope?.links.length} declared relationships and included unresolved entries</p>
      <img src={preview.url} alt="Proposed JSON Schema diagram" onLoad={() => setPainted(true)}
        onError={() => setError("The proposed diagram could not be displayed.")} />
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={() => setPreview(undefined)}>Back to facts</button>
        <button type="button" className="button primary" disabled={!!busy || !painted} onClick={create}>Create schema project</button>
      </div>
    </section>}
    {busy && <p role="status">{busy}…</p>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {retry && <button type="button" className="button secondary" onClick={() => read(true)}>Retry with more time</button>}
  </Modal>;
}
