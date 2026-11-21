import { useEffect, useRef, useState } from "react";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import TerraformWorker from "../lib/authoring/terraform-import.worker?worker&inline";
import type { TerraformFacts } from "../lib/authoring/terraform-facts";
import { validateVirtualPath } from "../lib/authoring/openapi-facts";
import { prepareTerraformProject, terraformScope } from "../lib/authoring/terraform-project";
import { buildExportFrame } from "../lib/export";
import { discardGuidedCheckpoint } from "../lib/persistence/guided-drafts";
import { exportTerraformScope, listTerraformCheckpoints, restoreTerraformScope, saveTerraformCheckpoint, type TerraformCheckpoint } from "../lib/persistence/terraform-drafts";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { downloadText } from "../lib/storage";
import Modal from "./Modal";

type Preview = Awaited<ReturnType<typeof prepareTerraformProject>> & { url: string };
const count = (value: number, label: string) => `${value} ${label}${value === 1 ? "" : "s"}`;
const savingScope = "Saving the inventory scope";
const discardingScope = "Discarding the inventory scope";
const savingInventory = "Saving the inventory";

export default function TerraformImportDialog({ onBack, onClose, onCreated }: {
  onBack: () => void; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [file, setFile] = useState<File>();
  const [path, setPath] = useState("");
  const [facts, setFacts] = useState<TerraformFacts>();
  const [selected, setSelected] = useState(new Set<string>());
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [includeReferences, setIncludeReferences] = useState(false);
  const [checkpoints, setCheckpoints] = useState<TerraformCheckpoint[]>([]);
  const [checkpoint, setCheckpoint] = useState<TerraformCheckpoint>();
  const [restored, setRestored] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const stageHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => { if (facts) stageHeading.current?.focus(); }, [facts, preview]);
  useEffect(() => {
    let closed = false;
    void openWorkspaceDatabase().then(async db => {
      try {
        const saved = await listTerraformCheckpoints(db);
        if (!closed) setCheckpoints(saved);
      } finally { db.close(); }
    }).catch(() => { if (!closed) setNotice("Saved Terraform scopes could not be read."); });
    return () => { closed = true; };
  }, []);

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>, canRetry = false) {
    if (controller.current) return;
    const work = new AbortController();
    controller.current = work;
    setBusy(label);
    setError("");
    setNotice("");
    setRetry(false);
    try { await action(work.signal); }
    catch (reason) {
      if (!work.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "The Terraform import could not continue.");
        setRetry(canRetry && reason instanceof AuthoringWorkerTimeout);
      }
    } finally {
      controller.current = null;
      if (!work.signal.aborted) setBusy("");
    }
  }

  function read(extended = false) {
    if (!file) return;
    void run("Reading Terraform facts", async signal => {
      if (file.size > 2_000_000) throw new Error("Choose a Terraform JSON file no larger than 2,000,000 bytes.");
      const virtualPath = validateVirtualPath(path);
      const bytes = await file.arrayBuffer();
      const result = await runAuthoringWorker<TerraformFacts>(() => new TerraformWorker(), { bytes, virtualPath }, signal, "Reading Terraform facts", extended);
      signal.throwIfAborted();
      setFacts(result);
      setFile(undefined);
      setSelected(new Set());
      setCheckpoint(undefined);
      setRestored(false);
      setQuery("");
      setLimit(50);
      setIncludeReferences(false);
    }, !extended);
  }

  function resume(saved: TerraformCheckpoint) {
    const scope = restoreTerraformScope(saved);
    setFacts(scope.facts);
    setSelected(new Set(scope.selection));
    setIncludeReferences(scope.includeReferences);
    setCheckpoint(saved);
    setRestored(true);
    setFile(undefined);
    setPath("");
    setQuery("");
    setLimit(50);
    setError("");
    setRetry(false);
    setNotice("Inventory scope restored. Preview the scope before creating a project.");
  }

  function saveScope(destination?: "close" | "files") {
    if (!facts) return;
    void run(savingScope, async signal => {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        const saved = await saveTerraformCheckpoint(db, { facts, selection: selected, includeReferences }, checkpoint);
        setCheckpoints(items => [saved, ...items.filter(item => item.id !== saved.id)]);
        setCheckpoint(saved);
        setNotice("Inventory facts and scope saved in this browser.");
        if (destination === "close") onClose();
        if (destination === "files") setFacts(undefined);
      } finally { db.close(); }
    });
  }

  function discard(saved: TerraformCheckpoint, close = false) {
    void run(discardingScope, async signal => {
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

  function downloadScope() {
    if (!facts) return;
    setError("");
    try {
      const scope = exportTerraformScope({ facts, selection: selected, includeReferences });
      downloadText(scope, "terraform-scope.meridian-draft.json");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The scope draft could not be downloaded.");
    }
  }

  function review() {
    if (!facts) return;
    void run("Rendering the proposed inventory", async signal => {
      const result = await prepareTerraformProject(facts, selected, includeReferences, signal);
      signal.throwIfAborted();
      const svg = buildExportFrame(result.rendered, result.document).svg;
      setPainted(false);
      setPreview({ ...result, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    });
  }

  function create() {
    if (!preview || !painted) return;
    void run(savingInventory, async signal => {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        await writeWorkspaceProject(db, preview.document, null);
        if (checkpoint) await discardGuidedCheckpoint(db, checkpoint).catch(() => undefined);
        onCreated(preview.document.id);
      } finally { db.close(); }
    });
  }

  const scope = facts && terraformScope(facts, selected, includeReferences);
  const matches = facts?.resources.filter(item => item.address.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const visible = matches.slice(0, limit);
  const hiddenSelected = selected.size - visible.filter(item => selected.has(item.address)).length;
  return <Modal title="Terraform inventory" wide busy={[savingScope, discardingScope, savingInventory].includes(busy)} onClose={close}>
    {!facts && <form className="heading-form" onSubmit={event => { event.preventDefault(); read(); }}>
      <p>Open a Terraform show JSON plan or state file. Meridian reads it locally and keeps selected resource addresses and declared configuration references in the new diagram.</p>
      {!!checkpoints.length && <ul className="project-list" aria-label="Saved Terraform scopes">
        {checkpoints.map(item => <li className="project-row" key={item.id}>
          <button type="button" className="project-open" disabled={!!busy} onClick={() => resume(item)}>
            <strong>Resume {item.payload.virtualPaths[0]}</strong>
            <small>{count(item.payload.selectedFactIds.length, "selected resource")}</small>
          </button>
          <button type="button" className="button quiet" disabled={!!busy} onClick={() => discard(item)}>Discard scope draft</button>
        </li>)}
      </ul>}
      <label>Terraform JSON file<input type="file" accept=".json,application/json" disabled={!!busy} onChange={event => {
        const chosen = event.target.files?.[0];
        setFile(chosen);
        setPath(chosen?.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "");
      }} /></label>
      <label>Virtual path<input value={path} disabled={!!busy} maxLength={200} onChange={event => setPath(event.target.value)} /></label>
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={onBack}>Back</button>
        <button type="submit" className="button primary" disabled={!!busy || !file || !path}>Read Terraform facts</button>
      </div>
    </form>}
    {facts && !preview && <div className="heading-form">
      <h3 ref={stageHeading} tabIndex={-1}>Choose inventory scope</h3>
      <p>{facts.planned ? "Planned resource inventory" : "State resource inventory"} · {facts.virtualPath}</p>
      {restored ? <p>{facts.resources.length} available resources. Read the original file to view input coverage.</p> : <>
        <p>{facts.resources.length} available resources · {facts.omitted} unsupported entries · {facts.unresolved} unresolved references</p>
        {!facts.hasConfiguration && <p>Declared configuration references are unavailable for this inventory.</p>}
        {facts.unmatchedConfiguration > 0 && <p>{count(facts.unmatchedConfiguration, "inventory address")} without an exact configuration address.
          Declared outgoing reference coverage is unavailable for those resources.</p>}
      </>}
      <label>Find resources<input value={query} maxLength={200} disabled={!!busy} onChange={event => { setQuery(event.target.value); setLimit(50); }} /></label>
      <p role="status">{count(selected.size, "selected resource")} · {hiddenSelected} outside visible rows · {count(scope?.references.length ?? 0, "selected reference")}</p>
      {!visible.length && <p>No resource addresses match this view.</p>}
      <ul className="project-list">
        {visible.map(item =>
          <li className="project-row" key={item.address}><label>
            <input type="checkbox" checked={selected.has(item.address)} disabled={!!busy || (selected.size >= 100 && !selected.has(item.address))}
              onChange={event => setSelected(previous => {
                const next = new Set(previous);
                if (event.target.checked) next.add(item.address);
                else next.delete(item.address);
                return next;
              })} /> {item.address}
          </label></li>)}
      </ul>
      {matches.length > limit && <button type="button" className="button quiet" onClick={() => setLimit(value => value + 50)}>Show more resources</button>}
      <label className="check-label"><input type="checkbox" checked={includeReferences} disabled={!!busy || !facts.references.length}
        onChange={event => setIncludeReferences(event.target.checked)} /> Show declared references between selected resources</label>
      {scope && scope.references.length > 200 && <p>Choose a scope with up to 200 references.</p>}
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy}
          onClick={() => selected.size || checkpoint ? saveScope("files") : setFacts(undefined)}>Choose another file</button>
        <button type="button" className="button quiet" disabled={!!busy}
          onClick={() => checkpoint ? discard(checkpoint, true) : onClose()}>Discard this scope</button>
        <button type="button" className="button secondary" disabled={!!busy} onClick={() => saveScope()}>Save scope draft</button>
        <button type="button" className="button quiet" disabled={!!busy} onClick={downloadScope}>Download scope draft</button>
        <button type="button" className="button primary" disabled={!!busy || !selected.size || (scope?.references.length ?? 0) > 200}
          onClick={review}>Preview inventory</button>
      </div>
    </div>}
    {preview && <section className="migration-preview" aria-label="Proposed inventory">
      <h3 ref={stageHeading} tabIndex={-1}>Review inventory</h3>
      <p>{count(selected.size, "resource")} · {count(scope?.references.length ?? 0, "declared configuration reference")}</p>
      {scope?.resources.some(item => item.address.includes("[")) && <p>Diagram labels show numeric instance indexes with full-width brackets, such as ［0］.</p>}
      <img src={preview.url} alt="Proposed Terraform inventory" onLoad={() => setPainted(true)}
        onError={() => setError("The proposed inventory could not be displayed.")} />
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={() => setPreview(undefined)}>Back to resources</button>
        <button type="button" className="button primary" disabled={!!busy || !painted} onClick={create}>Create inventory project</button>
      </div>
    </section>}
    {busy && <p role="status">{busy}…</p>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {retry && <button type="button" className="button secondary" onClick={() => read(true)}>Retry with more time</button>}
  </Modal>;
}
