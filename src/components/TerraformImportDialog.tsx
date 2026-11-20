import { useEffect, useRef, useState } from "react";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import TerraformWorker from "../lib/authoring/terraform-import.worker?worker&inline";
import type { TerraformFacts } from "../lib/authoring/terraform-facts";
import { validateVirtualPath } from "../lib/authoring/openapi-facts";
import { prepareTerraformProject, terraformScope } from "../lib/authoring/terraform-project";
import { buildExportFrame } from "../lib/export";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import Modal from "./Modal";

type Preview = Awaited<ReturnType<typeof prepareTerraformProject>> & { url: string };
const count = (value: number, label: string) => `${value} ${label}${value === 1 ? "" : "s"}`;

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
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>, canRetry = false) {
    if (controller.current) return;
    const work = new AbortController();
    controller.current = work;
    setBusy(label);
    setError("");
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
      setQuery("");
      setLimit(50);
      setIncludeReferences(false);
    }, !extended);
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
    void run("Saving the inventory", async signal => {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        await writeWorkspaceProject(db, preview.document, null);
        onCreated(preview.document.id);
      } finally { db.close(); }
    });
  }

  const scope = facts && terraformScope(facts, selected, includeReferences);
  const matches = facts?.resources.filter(item => item.address.toLowerCase().includes(query.trim().toLowerCase())) ?? [];
  const visible = matches.slice(0, limit);
  const hiddenSelected = selected.size - visible.filter(item => selected.has(item.address)).length;
  return <Modal title="Terraform inventory" wide busy={busy === "Saving the inventory"} onClose={onClose}>
    {!facts && <form className="heading-form" onSubmit={event => { event.preventDefault(); read(); }}>
      <p>Open a Terraform show JSON plan or state file. Meridian reads it locally and keeps selected resource addresses and declared configuration references in the new diagram.</p>
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
      <p>{facts.planned ? "Planned resource inventory" : "State resource inventory"} · {facts.virtualPath}</p>
      <p>{facts.resources.length} available resources · {facts.omitted} unsupported entries · {facts.unresolved} unresolved references</p>
      {!facts.hasConfiguration && <p>Declared configuration references are unavailable for this inventory.</p>}
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
        <button type="button" className="button quiet" disabled={!!busy} onClick={() => setFacts(undefined)}>Choose another file</button>
        <button type="button" className="button primary" disabled={!!busy || !selected.size || (scope?.references.length ?? 0) > 200}
          onClick={review}>Preview inventory</button>
      </div>
    </div>}
    {preview && <section className="migration-preview" aria-label="Proposed inventory">
      <p>{count(selected.size, "resource")} · {count(scope?.references.length ?? 0, "declared configuration reference")}</p>
      <img src={preview.url} alt="Proposed Terraform inventory" onLoad={() => setPainted(true)}
        onError={() => setError("The proposed inventory could not be displayed.")} />
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={() => setPreview(undefined)}>Back to resources</button>
        <button type="button" className="button primary" disabled={!!busy || !painted} onClick={create}>Create inventory project</button>
      </div>
    </section>}
    {busy && <p role="status">{busy}…</p>}
    {error && <p role="alert">{error}</p>}
    {retry && <button type="button" className="button secondary" onClick={() => read(true)}>Retry with more time</button>}
  </Modal>;
}
