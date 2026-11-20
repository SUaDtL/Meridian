import { useEffect, useRef, useState } from "react";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import OpenApiWorker from "../lib/authoring/openapi-import.worker?worker&inline";
import { validateVirtualPath, type OpenApiFacts } from "../lib/authoring/openapi-facts";
import { openApiNodeLimit, openApiSchemaScope, prepareOpenApiProject, prepareOpenApiSchemaProject,
  type OpenApiChoice, type OpenApiSchemaChoice } from "../lib/authoring/openapi-project";
import { buildExportFrame } from "../lib/export";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import Modal from "./Modal";

const rowLimit = 50;
type Review = Awaited<ReturnType<typeof prepareOpenApiProject>> & { url: string };
const countLabel = (count: number, singular: string) => `${count} ${singular}${count === 1 ? "" : "s"}`;

export default function OpenApiImportDialog({ onBack, onClose, onCreated, onTerraform, onSchema }: {
  onBack: () => void; onClose: () => void; onCreated: (id: string) => void; onTerraform: () => void; onSchema: () => void;
}) {
  const [file, setFile] = useState<File>();
  const [path, setPath] = useState("");
  const [facts, setFacts] = useState<OpenApiFacts>();
  const [view, setView] = useState<"operations" | "schemas">("operations");
  const [title, setTitle] = useState("");
  const [query, setQuery] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(rowLimit);
  const [choices, setChoices] = useState<ReadonlyMap<string, OpenApiChoice>>(new Map());
  const [schemas, setSchemas] = useState<ReadonlyMap<string, OpenApiSchemaChoice>>(new Map());
  const [review, setReview] = useState<Review>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url); }, [review]);
  useEffect(() => { if (facts || review) heading.current?.focus(); }, [facts, review]);

  async function run(label: string, task: (signal: AbortSignal) => Promise<void>, canRetry = false) {
    if (controller.current) return;
    const action = new AbortController();
    controller.current = action;
    setBusy(label);
    setError("");
    setRetry(false);
    try {
      await task(action.signal);
    } catch (reason) {
      if (!action.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "The OpenAPI import could not continue.");
        setRetry(canRetry && reason instanceof AuthoringWorkerTimeout);
      }
    } finally {
      controller.current = null;
      if (!action.signal.aborted) setBusy("");
    }
  }

  function extract(extended = false) {
    if (!file) return;
    const schemaMode = view === "schemas";
    void run(schemaMode ? "Reading schemas" : "Reading operations", async signal => {
      if (file.size > 2_000_000) throw new Error("Choose an OpenAPI file no larger than 2,000,000 bytes.");
      const virtualPath = validateVirtualPath(path);
      const bytes = await file.arrayBuffer();
      const format = /\.ya?ml$/i.test(file.name) ? "yaml" : undefined;
      const parsed = await runAuthoringWorker<OpenApiFacts>(() => new OpenApiWorker(),
        { bytes, virtualPath, format, view: schemaMode ? "schemas" : undefined }, signal, "Reading OpenAPI facts", extended);
      signal.throwIfAborted();
      setFile(undefined);
      setFacts(parsed);
      setChoices(new Map());
      setSchemas(new Map());
      setQuery("");
      setVisibleLimit(rowLimit);
      setTitle(schemaMode ? "OpenAPI schema relationships" : "New diagram from file");
    }, !extended);
  }

  function preview() {
    if (!facts || !(facts.schemaView ? schemas.size : choices.size)) return;
    void run("Checking and rendering the proposed diagram", async signal => {
      const candidate = facts.schemaView
        ? await prepareOpenApiSchemaProject(title.trim() || "OpenAPI schema relationships", facts, schemas, signal)
        : await prepareOpenApiProject(title.trim() || "New diagram from file", facts,
          facts.operations.flatMap(operation => choices.has(operation.key) ? [choices.get(operation.key)!] : []), signal);
      signal.throwIfAborted();
      const image = buildExportFrame(candidate.rendered, candidate.document).svg;
      const url = URL.createObjectURL(new Blob([image], { type: "image/svg+xml" }));
      setPainted(false);
      setReview({ ...candidate, url });
    });
  }

  function create() {
    if (!review || !painted) return;
    void run("Saving the new diagram", async signal => {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        await writeWorkspaceProject(db, review.document, null);
        onCreated(review.document.id);
      } finally { db.close(); }
    });
  }

  function change(key: string, next?: OpenApiChoice) {
    setChoices(previous => {
      const updated = new Map(previous);
      if (next) updated.set(key, next);
      else updated.delete(key);
      return updated;
    });
  }

  function changeSchema(key: string, label?: string) {
    setSchemas(previous => {
      const updated = new Map(previous);
      if (label === undefined) updated.delete(key);
      else updated.set(key, { key, label });
      return updated;
    });
  }

  const needle = query.trim().toLowerCase();
  const schemaFacts = facts?.schemaView;
  const matchingSchemas = schemaFacts?.schemas.filter(item => item.key.toLowerCase().includes(needle)) ?? [];
  const visibleSchemas = matchingSchemas.slice(0, visibleLimit);
  const schemaScope = facts && schemaFacts ? openApiSchemaScope(facts, schemas) : undefined;
  const selectedReferences = schemaScope?.references.length ?? 0;
  const scopeTooLarge = schemas.size > openApiNodeLimit || selectedReferences > 200;
  const matching = facts?.operations.filter(({ key, tags, method, path }) =>
    [key, method, path, ...tags].some(value => value.toLowerCase().includes(needle))) ?? [];
  const visible = matching.slice(0, visibleLimit);
  const selected = [...choices.values()];
  const totalNodes = choices.size + new Set(selected.flatMap(item => item.tag === null ? [] : [item.tag])).size;
  const selectedHidden = choices.size - visible.filter(item => choices.has(item.key)).length;

  return <Modal title="Engineering file" wide busy={busy === "Saving the new diagram"} onClose={onClose}>
    <h3 ref={heading} tabIndex={-1}>{review ? "Review your new diagram" : facts
      ? schemaFacts ? "Choose schema scope" : "Choose operation scope" : "New diagram from file"}</h3>
    {!facts && <form className="heading-form" onSubmit={event => { event.preventDefault(); extract(); }}>
      <p>Import declared operations or schema relationships from an OpenAPI 3.0 or 3.1 JSON or restricted YAML file. Meridian reads the file in this browser and retains only selected facts in the new diagram.</p>
      <label>OpenAPI view<select value={view} disabled={!!busy} onChange={event => {
        setView(event.target.value === "schemas" ? "schemas" : "operations");
        setError(""); setRetry(false);
      }}><option value="operations">Operations by tag</option><option value="schemas">Schema relationships</option></select></label>
      <label>OpenAPI specification<input type="file" accept=".json,.yaml,.yml,application/json,application/yaml,text/yaml" disabled={!!busy} onChange={event => {
        const selected = event.target.files?.[0];
        setFile(selected);
        setPath(selected?.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "");
        setError(""); setRetry(false);
      }} /></label>
      <label>Virtual path<input value={path} disabled={!!busy} maxLength={200}
        onChange={event => { setPath(event.target.value); setError(""); setRetry(false); }} /></label>
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={onBack}>Back</button>
        <button type="button" className="button secondary" disabled={!!busy} onClick={onTerraform}>Import Terraform JSON</button>
        <button type="button" className="button secondary" disabled={!!busy} onClick={onSchema}>Import JSON Schema</button>
        <button type="submit" className="button primary" disabled={!file || !path || !!busy}>
          {view === "schemas" ? "Read schema facts" : "Read operation facts"}
        </button>
      </div>
    </form>}
    {facts && schemaFacts && !review && <form className="heading-form" onSubmit={event => { event.preventDefault(); preview(); }}>
      <p>OpenAPI {facts.version} · {facts.virtualPath} · {countLabel(schemaFacts.schemas.length, "schema")}</p>
      <p>{countLabel(schemaFacts.references.length, "resolved reference")} · {countLabel(schemaFacts.unresolved, "unresolved reference")}
        {" · "}{countLabel(schemaFacts.omitted, "unsupported schema location")}</p>
      <p>Connections show declared references to named components in this file. External files, anchors and unsupported schema locations have separate coverage above.</p>
      <label>Diagram title<input value={title} maxLength={120} disabled={!!busy} onChange={event => setTitle(event.target.value)} /></label>
      <label>Find schemas<input value={query} maxLength={160} disabled={!!busy}
        onChange={event => { setQuery(event.target.value); setVisibleLimit(rowLimit); }} /></label>
      <p role="status">{schemas.size} selected · {schemas.size - visibleSchemas.filter(item => schemas.has(item.key)).length} selected outside visible rows
        {" · "}{countLabel(selectedReferences, "selected reference")}</p>
      {scopeTooLarge && <p role="alert">Choose a scope of up to 100 schemas and 200 references.</p>}
      {!visibleSchemas.length && <p>No schema facts match this view.</p>}
      <ul className="project-list">{visibleSchemas.map(({ key }) => {
        const current = schemas.get(key);
        return <li className="project-row" key={key}><div>
          <label><input type="checkbox" checked={!!current} disabled={!!busy}
            onChange={event => changeSchema(key, event.target.checked ? key : undefined)} />{key}</label>
          {current && <label>Display label<input value={current.label} maxLength={400} disabled={!!busy}
            onChange={event => changeSchema(key, event.target.value)} /></label>}
        </div></li>;
      })}</ul>
      {visibleSchemas.length < matchingSchemas.length && <button type="button" className="button quiet"
        onClick={() => setVisibleLimit(value => value + rowLimit)}>Show more schemas</button>}
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={() => { setFacts(undefined); setError(""); }}>Choose another file</button>
        <button type="submit" className="button primary" disabled={!!busy || !schemas.size || scopeTooLarge}>Preview diagram</button>
      </div>
    </form>}
    {facts && !schemaFacts && !review && <form className="heading-form" onSubmit={event => { event.preventDefault(); preview(); }}>
      <p>OpenAPI {facts.version} · {facts.virtualPath} · {facts.operations.length} operation facts</p>
      <p>Unresolved referenced path items: {facts.referencedPathCount}. Schema definitions outside this view: {facts.uncheckedSchemaCount}.</p>
      <label>Diagram title<input value={title} maxLength={120} disabled={!!busy} onChange={event => setTitle(event.target.value)} /></label>
      <label>Find operations<input value={query} maxLength={160} disabled={!!busy}
        onChange={event => { setQuery(event.target.value); setVisibleLimit(rowLimit); }} /></label>
      <p role="status">{choices.size} selected · {selectedHidden} selected outside visible rows · {matching.length} matches</p>
      {totalNodes > openApiNodeLimit && <p role="alert">The selection would create {totalNodes} nodes. Choose a scope of up to 100 nodes.</p>}
      {visible.length === 0 && <p>No operation facts match this view.</p>}
      <ul className="project-list">
        {visible.map(operation => {
          const current = choices.get(operation.key);
          const label = `${operation.method.toUpperCase()} ${operation.path}`;
          const suggestedLabel = operation.key === label ? label.replace(/\{([^{}]+)\}/g, "$1") : `${operation.method.toUpperCase()} ${operation.key}`;
          return <li className="project-row" key={operation.key}>
            <div>
              <label><input type="checkbox" checked={!!current} disabled={!!busy}
                onChange={event => change(operation.key, event.target.checked ? { key: operation.key, label: suggestedLabel, tag: operation.tags.length === 1 ? operation.tags[0] : null } : undefined)} />
                {label}</label>
              {!!operation.tags.length && <p className="muted-note">{operation.tags.join(", ")}</p>}
              {current && <>
                <label>Display label<input value={current.label} maxLength={400} disabled={!!busy}
                  onChange={event => change(operation.key, { ...current, label: event.target.value })} /></label>
                {!!operation.tags.length && <label>Primary tag<select value={current.tag ?? ""} disabled={!!busy}
                  onChange={event => change(operation.key, { ...current, tag: event.target.value || null })}>
                  <option value="">No tag connection</option>{operation.tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
                </select></label>}
              </>}
            </div>
          </li>;
        })}
      </ul>
      {visible.length < matching.length && <button type="button" className="button quiet" onClick={() => setVisibleLimit(value => value + rowLimit)}>Show more operations</button>}
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={() => { setFacts(undefined); setError(""); }}>Choose another file</button>
        <button type="submit" className="button primary" disabled={!!busy || !choices.size || totalNodes > openApiNodeLimit}>Preview diagram</button>
      </div>
    </form>}
    {facts && review && <>
      <p>{countLabel(review.nodes, "node")} · {countLabel(review.edges, "connection")} · {schemaFacts
        ? countLabel(facts.uncheckedSchemaCount - schemas.size, "schema")
        : countLabel(facts.operations.length - choices.size, "operation fact")} omitted</p>
      <p>Connections show {schemaFacts ? "declared OpenAPI schema references" : "declared OpenAPI tag membership"}.
        {" "}The project keeps the file’s virtual path, a JSON pointer and the meaning of each imported relationship.</p>
      <div className="migration-preview"><img src={review.url} alt={schemaFacts ? "Proposed OpenAPI schema diagram" : "Proposed OpenAPI operation diagram"}
        onLoad={() => setPainted(true)} onError={() => setError("The proposed diagram could not be displayed.")} /></div>
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={!!busy} onClick={() => { setReview(undefined); setError(""); }}>Back to scope</button>
        <button type="button" className="button primary" disabled={!!busy || !painted} onClick={create}>Create new diagram</button>
      </div>
    </>}
    {busy && <p role="status">{busy}…</p>}
    {error && <p role="alert">{error}</p>}
    {retry && <button className="button secondary" onClick={() => extract(true)}>Retry with more time</button>}
  </Modal>;
}
