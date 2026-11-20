import { useEffect, useRef, useState } from "react";
import { canonicalDigest } from "../lib/authoring/base-token";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import { maxComponentLibraryBytes, type ComponentDefinition, type parseComponentFile } from "../lib/authoring/component-definition";
import ComponentFileWorker from "../lib/authoring/component-file.worker?worker&inline";
import { buildComponentProject } from "../lib/authoring/component-project";
import { curatedComponents } from "../lib/authoring/curated-components";
import { buildExportFrame } from "../lib/export";
import { readComponentLibrary, saveComponentDefinitions } from "../lib/persistence/component-library";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { downloadText } from "../lib/storage";
import Modal from "./Modal";

type Preview = Awaited<ReturnType<typeof buildComponentProject>> & { url: string };

export default function ComponentProjectDialog({ onCreated, onBack, onClose }: {
  onCreated: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [sessionComponents, setSessionComponents] = useState<ComponentDefinition[]>([]);
  const [library, setLibrary] = useState<ComponentDefinition[]>([]);
  const [libraryStatus, setLibraryStatus] = useState("");
  const [retryFile, setRetryFile] = useState<File>();
  const [definition, setDefinition] = useState<ComponentDefinition>();
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [disconnected, setDisconnected] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState<"read" | "preview" | "create">();
  const [error, setError] = useState("");
  const work = useRef<AbortController | undefined>(undefined);
  const choices = [...sessionComponents, ...library, ...curatedComponents].filter(component =>
    [component.name, component.description, ...component.tags].join(" ").toLowerCase().includes(query.trim().toLowerCase()));

  useEffect(() => () => work.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    let closed = false;
    void openWorkspaceDatabase().then(async db => {
      try {
        const stored = await readComponentLibrary(db);
        if (!closed) setLibrary(stored);
      } finally { db.close(); }
    }).catch(() => { if (!closed) setLibraryStatus("The local component library could not be opened."); });
    return () => { closed = true; };
  }, []);

  function select(component: ComponentDefinition) {
    setDefinition(component);
    setValues({});
    setDisconnected(false);
    setPreview(undefined);
    setError("");
  }

  async function run(action: NonNullable<typeof busy>, execute: (signal: AbortSignal) => Promise<void>) {
    if (work.current) return;
    const controller = new AbortController();
    work.current = controller;
    setBusy(action);
    setError("");
    try { await execute(controller.signal); } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The component could not be opened.");
    } finally {
      work.current = undefined;
      if (!controller.signal.aborted) setBusy(undefined);
    }
  }

  async function importFile(file: File, signal: AbortSignal, extended = false) {
    setRetryFile(undefined);
    if (file.size > maxComponentLibraryBytes) throw new Error("Choose a library file no larger than 10,000,000 bytes.");
    const content = await file.arrayBuffer();
    signal.throwIfAborted();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    let parsed: ReturnType<typeof parseComponentFile>;
    try {
      parsed = await runAuthoringWorker<ReturnType<typeof parseComponentFile>>(() => new ComponentFileWorker(),
        { text }, signal, "Reading the component file", extended);
    } catch (reason) {
      if (reason instanceof AuthoringWorkerTimeout && !extended) setRetryFile(file);
      if (reason instanceof AuthoringWorkerTimeout && extended) throw new Error("Choose a smaller component library file.");
      throw reason;
    }
    setSessionComponents([]);
    try {
      const db = await openWorkspaceDatabase();
      try {
        const outcomes = await saveComponentDefinitions(db, parsed.definitions, curatedComponents);
        setLibrary(current => {
          const next = new Map(current.map(item => [`${item.id}:${item.version}`, item]));
          for (const outcome of outcomes) if (!outcome.bundled) next.set(`${outcome.definition.id}:${outcome.definition.version}`, outcome.definition);
          return [...next.values()];
        });
        if (parsed.pack) {
          const added = outcomes.filter(outcome => outcome.status !== "available").length;
          const copies = outcomes.filter(outcome => outcome.status === "copied").length;
          const conflicts = copies === 1 ? " One conflict was saved as a separate copy."
            : copies > 1 ? ` ${copies} conflicts were saved as separate copies.` : "";
          setLibraryStatus(`${added} ${added === 1 ? "component" : "components"} saved locally.${conflicts}`);
        } else {
          const [outcome] = outcomes;
          setLibraryStatus(outcome.status === "available" ? "This definition was already available."
            : outcome.status === "copied" ? "Saved a separate local copy of the conflicting definition." : "Component saved locally.");
          select(outcome.definition);
        }
      } finally { db.close(); }
    } catch (reason) {
      setSessionComponents(parsed.definitions);
      if (!parsed.pack) select(parsed.definitions[0]);
      setLibraryStatus(`Session-only component. ${reason instanceof Error ? reason.message : "The local import could not be saved."}`);
    }
  }

  async function prepare(signal: AbortSignal) {
    if (!definition || (definition.ports.length && !disconnected)) return;
    const next = await buildComponentProject(definition, values, signal);
    const svg = buildExportFrame(next.rendered, next.document).svg;
    signal.throwIfAborted();
    setPainted(false);
    setPreview({ ...next, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
  }

  async function create(signal: AbortSignal) {
    if (!preview || !definition || !painted) return;
    if (await canonicalDigest("meridian-component/v1", [definition]) !== preview.definitionHash) {
      setPreview(undefined);
      throw new Error("The definition changed. Review the component again.");
    }
    signal.throwIfAborted();
    const db = await openWorkspaceDatabase();
    try { await writeWorkspaceProject(db, preview.document, null); } finally { db.close(); }
    onCreated(preview.document.id);
  }

  return (
    <Modal title="Components" wide busy={busy === "create" || busy === "read"} onClose={onClose}>
      {!definition && <div className="heading-form">
        <button className="button quiet" disabled={!!busy} onClick={onBack}>Process steps</button>
        <label>Search components<input value={query} maxLength={120} disabled={!!busy} onChange={event => setQuery(event.target.value)} /></label>
        <label>Import a component definition or library<input type="file" accept=".json,application/json" disabled={!!busy} onChange={event => {
          const file = event.target.files?.[0]; if (file) void run("read", signal => importFile(file, signal));
        }} /></label>
        {retryFile && <button className="button secondary" disabled={!!busy} onClick={() => void run("read", signal => importFile(retryFile, signal, true))}>Retry for five seconds</button>}
        {library.length > 0 && <button className="button secondary" disabled={!!busy}
          onClick={() => downloadText(JSON.stringify({ schema: "meridian-library/v1", definitions: library }, null, 2), "Meridian-component-library.json")}>Download component library</button>}
        {sessionComponents.length > 0 && <button className="button secondary" disabled={!!busy}
          onClick={() => downloadText(JSON.stringify({ schema: "meridian-library/v1", definitions: sessionComponents }, null, 2), "Meridian-session-components.json")}>Download session components</button>}
        <ul className="project-list">{choices.map((component, index) => <li key={`${component.id}-${index}`} className="project-row">
          <button className="project-open" disabled={!!busy} onClick={() => select(component)}>
            <span><strong>{component.name}</strong><small>{component.description}</small>
              <small>{component.fragment.nodes.length} nodes · {component.fragment.edges.length} connections</small></span>
          </button>
        </li>)}</ul>
        {!choices.length && <p>No matching components.</p>}
      </div>}
      {definition && !preview && <div className="heading-form">
        <h3>{definition.name}</h3><p>{definition.description}</p>
        {sessionComponents.includes(definition) && <button className="button secondary" disabled={!!busy}
          onClick={() => downloadText(JSON.stringify(definition, null, 2), "Meridian-component.json")}>Download session component</button>}
        {definition.parameters.map(parameter => <label key={parameter.id}>{parameter.label}
          {parameter.type === "enum" ? <select value={values[parameter.id] ?? parameter.default} disabled={!!busy}
            onChange={event => setValues(current => ({ ...current, [parameter.id]: event.target.value }))}>
            {parameter.choices.map(choice => <option key={choice}>{choice}</option>)}</select>
            : <input type={parameter.type === "integer" ? "number" : "text"} disabled={!!busy}
              min={parameter.type === "integer" ? parameter.minimum : undefined} max={parameter.type === "integer" ? parameter.maximum : undefined}
              maxLength={parameter.type === "text" ? parameter.maxLength * 2 : undefined} value={values[parameter.id] ?? parameter.default}
              onChange={event => setValues(current => ({ ...current, [parameter.id]: parameter.type === "integer" ? event.target.valueAsNumber : event.target.value }))} />}
        </label>)}
        {definition.ports.length > 0 && <>
          <h4>Attachment points</h4><ul>{definition.ports.map(port => <li key={port.id}>{port.label} · {port.direction}</li>)}</ul>
          <label className="check-label"><input type="checkbox" checked={disconnected} disabled={!!busy} onChange={event => setDisconnected(event.target.checked)} /> Leave the ports unconnected in this new project</label>
        </>}
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => { setDefinition(undefined); setError(""); }}>Back to components</button>
          <button className="button primary" disabled={!!busy || (definition.ports.length > 0 && !disconnected)} onClick={() => void run("preview", prepare)}>Preview component</button>
        </div>
      </div>}
      {preview && <div className="migration-preview">
        <h3>Review {definition?.name}</h3>
        <p>{preview.graph.nodes.length} nodes · {preview.graph.edges.length} connections · New project</p>
        <img src={preview.url} alt="Proposed component diagram" onLoad={() => setPainted(true)} onError={() => setError("The proposed diagram could not be displayed.")} />
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => setPreview(undefined)}>Back to component choices</button>
          <button className="button primary" disabled={!!busy || !painted} onClick={() => void run("create", create)}>Create component project</button>
        </div>
      </div>}
      {busy && <p role="status">{busy === "read" ? "Reading the local component file…" : busy === "preview" ? "Checking and rendering the component…" : "Saving the new project…"}</p>}
      {!busy && libraryStatus && <p role="status">{libraryStatus}</p>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
