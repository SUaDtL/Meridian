import { useEffect, useRef, useState } from "react";
import { canonicalDigest, canonicalJson, projectBaseToken, sameBaseToken } from "../lib/authoring/base-token";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import { maxComponentLibraryBytes, serializeComponentLibrary, type ComponentDefinition, type parseComponentFile } from "../lib/authoring/component-definition";
import ComponentFileWorker from "../lib/authoring/component-file.worker?worker&inline";
import type { PortAssignment } from "../lib/authoring/component-insertion";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildComponentProject, materializeComponent } from "../lib/authoring/component-project";
import { curatedComponents } from "../lib/authoring/curated-components";
import { buildExportFrame } from "../lib/export";
import { readComponentLibrary, removeComponentDefinition, replaceComponentDefinition, restoreComponentDefinition, saveComponentDefinitions } from "../lib/persistence/component-library";
import { listComponentCheckpoints, saveComponentCheckpoint, type ComponentCheckpoint, type ComponentDraft } from "../lib/persistence/component-drafts";
import { discardGuidedCheckpoint } from "../lib/persistence/guided-drafts";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { downloadText } from "../lib/storage";
import Modal from "./Modal";

type Preview = Awaited<ReturnType<typeof buildComponentProject>> & { url: string; proposal?: ReadyProposal; attachments?: number };
type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Insertion = { snapshot: Editor["snapshot"]; prepare: Editor["prepareInsertion"]; apply: Editor["applyInsertion"];
  nodes: readonly { id: string; label: string }[]; onApplied: () => void };
type DraftAttachment = { targetId: string; direction: "in" | "out" | null } | null;
type ImportConflict = { saved: ComponentDefinition; incoming: ComponentDefinition };
const count = (value: number, label: string) => `${value} ${label}${value === 1 ? "" : "s"}`;
const differenceLabels = {
  name: "Name", description: "Description", tags: "Tags", provenance: "Provenance and license",
  fragment: "Nodes, connections, and groups", parameters: "Parameters", labelBindings: "Label bindings", ports: "Attachment points",
} as const;

export default function ComponentProjectDialog({ onCreated, insertion, onBack, onClose }: {
  onBack: () => void;
  onClose: () => void;
} & ({ onCreated: (id: string) => void; insertion?: undefined } | { onCreated?: undefined; insertion: Insertion })) {
  const [query, setQuery] = useState("");
  const [sessionComponents, setSessionComponents] = useState<ComponentDefinition[]>([]);
  const [library, setLibrary] = useState<ComponentDefinition[]>([]);
  const [libraryStatus, setLibraryStatus] = useState("");
  const [removeCandidate, setRemoveCandidate] = useState<ComponentDefinition>();
  const [removedDefinition, setRemovedDefinition] = useState<ComponentDefinition>();
  const [importConflict, setImportConflict] = useState<ImportConflict>();
  const [retryFile, setRetryFile] = useState<File>();
  const [definition, setDefinition] = useState<ComponentDefinition>();
  const [drafts, setDrafts] = useState<ComponentCheckpoint[]>([]);
  const [checkpoint, setCheckpoint] = useState<ComponentCheckpoint>();
  const [changedDefinition, setChangedDefinition] = useState<ComponentCheckpoint>();
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [attachments, setAttachments] = useState(new Map<string, DraftAttachment>());
  const [targetQuery, setTargetQuery] = useState("");
  const [disconnected, setDisconnected] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState<"read" | "preview" | "create" | "draft" | "library">();
  const [error, setError] = useState("");
  const work = useRef<AbortController | undefined>(undefined);
  const removalHeading = useRef<HTMLHeadingElement>(null);
  const conflictHeading = useRef<HTMLHeadingElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const undoRemoval = useRef<HTMLButtonElement>(null);
  const projectId = insertion?.snapshot().id ?? null;
  const targetIds = new Set(insertion?.nodes.map(node => node.id));
  const choices = [...(insertion ? [] : sessionComponents), ...library, ...curatedComponents].filter(component =>
    [component.name, component.description, ...component.tags].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const readyPorts = !definition?.ports.length || (insertion
    ? definition.ports.every(port => {
      const choice = attachments.get(port.id);
      return choice === null || !!(choice?.direction && targetIds.has(choice.targetId));
    })
    : disconnected);
  const targetNeedle = targetQuery.trim().toLowerCase();

  useEffect(() => () => work.current?.abort(), []);
  useEffect(() => { if (removeCandidate) removalHeading.current?.focus(); }, [removeCandidate]);
  useEffect(() => { if (importConflict) conflictHeading.current?.focus(); }, [importConflict]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  useEffect(() => {
    let closed = false;
    void openWorkspaceDatabase().then(async db => {
      try {
        const [stored, saved] = await Promise.allSettled([readComponentLibrary(db), listComponentCheckpoints(db, projectId)]);
        if (closed) return;
        if (stored.status === "fulfilled") setLibrary(stored.value);
        if (saved.status === "fulfilled") setDrafts(saved.value);
        if (stored.status === "rejected" || saved.status === "rejected") {
          setLibraryStatus(stored.status === "rejected" ? "The local component library could not be read." : "Saved component drafts could not be read.");
        }
      } finally { db.close(); }
    }).catch(() => { if (!closed) setLibraryStatus("Saved components and drafts could not be opened."); });
    return () => { closed = true; };
  }, [projectId]);

  function select(component: ComponentDefinition) {
    setDefinition(component);
    setCheckpoint(undefined);
    setChangedDefinition(undefined);
    setValues({});
    setAttachments(new Map());
    setTargetQuery("");
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
      if (work.current === controller) {
        work.current = undefined;
        if (!controller.signal.aborted) setBusy(undefined);
      }
    }
  }

  async function restoreDraft(saved: ComponentCheckpoint, signal: AbortSignal, acceptChanged = false) {
    const state = saved.payload;
    const current = [...library, ...curatedComponents].find(item => item.id === state.definitionId && item.version === state.definitionVersion);
    if (!current) throw new Error("Import the matching component definition before resuming this draft.");
    const digest = await canonicalDigest("meridian-component/v1", [current]);
    if (digest !== state.definitionHash && !acceptChanged) {
      setChangedDefinition(saved);
      setError("The component definition changed. Review and explicitly use the current definition to continue.");
      return;
    }
    const currentToken = insertion && await projectBaseToken(insertion.snapshot());
    signal.throwIfAborted();
    select(current);
    setCheckpoint(digest === state.definitionHash ? saved : undefined);
    const parameterIds = new Set(current.parameters.map(parameter => parameter.id));
    setValues(Object.fromEntries(Object.entries(state.parameters).filter(([id]) => parameterIds.has(id))));
    const ports = new Map(current.ports.map(port => [port.id, port]));
    setAttachments(new Map(state.connections.flatMap(choice => {
      const port = ports.get(choice.portId);
      if (!port) return [];
      const attachment: DraftAttachment = choice.targetId === null ? null : { targetId: choice.targetId,
        direction: port.direction === "either" || port.direction === choice.direction ? choice.direction : null };
      return [[choice.portId, attachment] as const];
    })));
    setDisconnected(!insertion && current.ports.every(port =>
      state.connections.some(choice => choice.portId === port.id && choice.targetId === null)));
    setLibraryStatus(digest !== state.definitionHash ? "Review the current definition and all attachment choices before previewing."
      : currentToken && (!saved.baseToken || !sameBaseToken(saved.baseToken, currentToken))
        ? "This draft is from an earlier project revision. Review the current attachment targets."
        : "Component choices restored. Preview again before applying.");
  }

  function draftConnections(): ComponentDraft["connections"] {
    if (insertion) return [...attachments].map(([portId, choice]) => ({
      portId, targetId: choice?.targetId ?? null, direction: choice?.direction ?? null,
    }));
    return disconnected ? definition?.ports.map(port => ({ portId: port.id, targetId: null, direction: null })) ?? [] : [];
  }

  async function keepDraft(signal: AbortSignal) {
    if (!definition) return;
    materializeComponent(definition, values);
    const base = insertion ? await projectBaseToken(insertion.snapshot()) : null;
    const draft: ComponentDraft = {
      step: preview ? "review" : definition.ports.length ? "connections" : "parameters",
      definitionId: definition.id, definitionVersion: definition.version,
      definitionHash: await canonicalDigest("meridian-component/v1", [definition]),
      parameters: values, destination: { mode: insertion ? "insert" : "new", targetProjectId: base?.projectId ?? null },
      connections: draftConnections(),
    };
    signal.throwIfAborted();
    const db = await openWorkspaceDatabase();
    try {
      signal.throwIfAborted();
      const saved = await saveComponentCheckpoint(db, draft, base, checkpoint);
      setCheckpoint(saved);
      setDrafts(previous => [saved, ...previous.filter(item => item.id !== saved.id)]);
      setLibraryStatus("Component choices saved as a local draft.");
    } finally { db.close(); }
  }

  function leaveChoices(leave: () => void) {
    if (busy && busy !== "preview") return;
    if (work.current) {
      const pending = work.current;
      work.current = undefined;
      pending.abort();
      setBusy(undefined);
    }
    const connections = draftConnections();
    if (!definition || (checkpoint
      ? JSON.stringify([values, connections]) === JSON.stringify([checkpoint.payload.parameters, checkpoint.payload.connections])
      : !Object.keys(values).length && !connections.length)) {
      leave();
      return;
    }
    void run("draft", async signal => { await keepDraft(signal); leave(); });
  }

  async function discardDraft(saved: ComponentCheckpoint) {
    const db = await openWorkspaceDatabase();
    try {
      await discardGuidedCheckpoint(db, saved);
      setDrafts(previous => previous.filter(item => item.id !== saved.id));
      if (checkpoint?.id === saved.id) setCheckpoint(undefined);
      if (changedDefinition?.id === saved.id) setChangedDefinition(undefined);
    } finally { db.close(); }
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
        if (!parsed.pack) {
          const incoming = parsed.definitions[0];
          const saved = (await readComponentLibrary(db)).find(item => item.id === incoming.id && item.version === incoming.version);
          signal.throwIfAborted();
          if (saved && canonicalJson(saved) !== canonicalJson(incoming)) {
            setImportConflict({ saved, incoming });
            setLibraryStatus("");
            return;
          }
        }
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
      if (!parsed.pack && !insertion) select(parsed.definitions[0]);
      setLibraryStatus(`Session-only component. ${reason instanceof Error ? reason.message : "The local import could not be saved."}`);
    }
  }

  async function resolveConflict(action: 'copy' | 'replace', signal: AbortSignal) {
    if (!importConflict) return;
    const { saved, incoming } = importConflict;
    const db = await openWorkspaceDatabase();
    try {
      signal.throwIfAborted();
      const next = action === "replace" ? await replaceComponentDefinition(db, saved, incoming)
        : (await saveComponentDefinitions(db, [{ ...incoming, id: crypto.randomUUID() }], curatedComponents))[0].definition;
      setLibrary(previous => [...previous.filter(item => item.id !== next.id || item.version !== next.version), next]);
      setImportConflict(undefined);
      select(next);
      setLibraryStatus(action === "replace" ? "Saved the reviewed replacement definition." : "Saved a separate local copy of the conflicting definition.");
    } finally { db.close(); }
  }

  async function prepare(signal: AbortSignal) {
    if (!definition || !readyPorts) return;
    const requested = new Map<string, PortAssignment>();
    for (const [key, assignment] of attachments) {
      if (assignment === null) requested.set(key, null);
      else if (assignment.direction) requested.set(key, { targetId: assignment.targetId, direction: assignment.direction });
    }
    const next = insertion ? await insertion.prepare(definition, values, requested, signal)
      : await buildComponentProject(definition, values, signal);
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
    if (insertion && preview.proposal) {
      let status: Awaited<ReturnType<Insertion["apply"]>>;
      try {
        status = await insertion.apply(preview.proposal, signal);
      } catch (reason) {
        setPreview(undefined);
        throw reason;
      }
      if (status !== "applied") {
        setPreview(undefined);
        throw new Error(status === "stale" ? "The diagram changed. Review the current attachment targets."
          : "The component could not be inserted with Undo.");
      }
      if (checkpoint) await discardDraft(checkpoint).catch(() => undefined);
      insertion.onApplied();
      return;
    }
    if (!onCreated) return;
    const db = await openWorkspaceDatabase();
    try {
      if (!sessionComponents.includes(definition)) {
        const available = [...await readComponentLibrary(db), ...curatedComponents]
          .find(item => item.id === definition.id && item.version === definition.version);
        if (!available || await canonicalDigest("meridian-component/v1", [available]) !== preview.definitionHash) {
          setPreview(undefined);
          throw new Error("The saved definition changed. Review the current component before creating a project.");
        }
      }
      signal.throwIfAborted();
      await writeWorkspaceProject(db, preview.document, null);
    } finally { db.close(); }
    if (checkpoint) await discardDraft(checkpoint).catch(() => undefined);
    onCreated(preview.document.id);
  }

  function discardCurrentChoices() {
    void run("draft", async () => {
      if (checkpoint) await discardDraft(checkpoint);
      setDefinition(undefined);
      setPreview(undefined);
      setLibraryStatus("Component draft discarded.");
    });
  }

  async function removeDefinition(signal: AbortSignal) {
    if (!removeCandidate) return;
    const db = await openWorkspaceDatabase();
    try {
      signal.throwIfAborted();
      const removed = await removeComponentDefinition(db, removeCandidate);
      setLibrary(previous => previous.filter(item => item.id !== removed.id || item.version !== removed.version));
      setRemovedDefinition(removed);
      setRemoveCandidate(undefined);
      setLibraryStatus(`Removed ${removed.name} from the library.`);
      requestAnimationFrame(() => undoRemoval.current?.focus());
    } finally { db.close(); }
  }

  async function restoreDefinition(signal: AbortSignal) {
    if (!removedDefinition) return;
    const db = await openWorkspaceDatabase();
    try {
      signal.throwIfAborted();
      const restored = await restoreComponentDefinition(db, removedDefinition);
      setLibrary(previous => [...previous.filter(item => item.id !== restored.id || item.version !== restored.version), restored]
        .sort((left, right) => left.name.localeCompare(right.name)));
      setRemovedDefinition(undefined);
      setLibraryStatus(`Restored ${restored.name} to the library.`);
      requestAnimationFrame(() => document.getElementById(`component-${restored.id}-${restored.version}`)?.focus());
    } finally { db.close(); }
  }

  return (
    <Modal title={insertion ? "Insert component" : "Components"} wide busy={!!busy && busy !== "preview"}
      onClose={() => leaveChoices(onClose)}>
      {importConflict && <section className="heading-form" aria-label="Compare component definitions">
        <h3 ref={conflictHeading} tabIndex={-1}>Review changes to a saved component</h3>
        <p>Saved definition “{importConflict.saved.name}” · Imported definition “{importConflict.incoming.name}”</p>
        <p>Version {importConflict.saved.version} · {importConflict.saved.id}</p>
        <p>Existing projects keep their inserted elements and recorded definition digest.</p>
        <ul aria-label="Changed definition fields">{(Object.keys(differenceLabels) as (keyof typeof differenceLabels)[])
          .filter(field => canonicalJson(importConflict.saved[field]) !== canonicalJson(importConflict.incoming[field]))
          .map(field => <li key={field}>{differenceLabels[field]}</li>)}</ul>
        <details className="migration-preview component-definition-comparison"><summary>Compare exact definitions</summary>
          <h4>Saved definition</h4><pre tabIndex={0}>{JSON.stringify(importConflict.saved, null, 2)}</pre>
          <h4>Imported definition</h4><pre tabIndex={0}>{JSON.stringify(importConflict.incoming, null, 2)}</pre>
        </details>
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => {
            setImportConflict(undefined); setError("");
            requestAnimationFrame(() => importInput.current?.focus());
          }}>Cancel import</button>
          <button className="button secondary" disabled={!!busy} onClick={() => void run("library", signal => resolveConflict("replace", signal))}>Replace saved definition</button>
          <button className="button primary" disabled={!!busy} onClick={() => void run("library", signal => resolveConflict("copy", signal))}>Import as copy</button>
        </div>
      </section>}
      {removeCandidate && <section className="heading-form" aria-label="Review library removal">
        <h3 ref={removalHeading} tabIndex={-1}>Remove {removeCandidate.name} from the local library</h3>
        <p>Version {removeCandidate.version} · {removeCandidate.id.slice(0, 8)}</p>
        <p>Inserted copies belong to their projects. You can undo the most recent library removal while this dialog stays open.</p>
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => {
            const id = removeCandidate.id, version = removeCandidate.version;
            setRemoveCandidate(undefined); setError("");
            requestAnimationFrame(() => document.getElementById(`remove-component-${id}-${version}`)?.focus());
          }}>Cancel removal</button>
          <button className="button primary" disabled={!!busy} onClick={() => void run("library", removeDefinition)}>Remove definition</button>
        </div>
      </section>}
      {!definition && !removeCandidate && !importConflict && <div className="heading-form">
        <button className="button quiet" disabled={!!busy} onClick={onBack}>{insertion ? "Back to diagram" : "Process steps"}</button>
        {!!drafts.length && <ul className="project-list" aria-label="Component drafts">
          {drafts.map(saved => {
            const name = [...library, ...curatedComponents].find(item => item.id === saved.payload.definitionId
              && item.version === saved.payload.definitionVersion)?.name || "unavailable component";
            return <li key={saved.id} className="project-row">
              <button className="project-open" disabled={!!busy} onClick={() => void run("draft", signal => restoreDraft(saved, signal))}>
                <span><strong>Resume {name} draft</strong><small>{new Date(saved.createdAt).toLocaleString()}</small></span>
              </button>
              <button className="button quiet" disabled={!!busy} onClick={() => void run("draft", () => discardDraft(saved))}>Discard draft</button>
            </li>;
          })}
        </ul>}
        {changedDefinition && <button className="button secondary" disabled={!!busy}
          onClick={() => void run("draft", signal => restoreDraft(changedDefinition, signal, true))}>Use current definition</button>}
        <label>Search components<input value={query} maxLength={120} disabled={!!busy} onChange={event => setQuery(event.target.value)} /></label>
        <label>Import a component definition or library<input ref={importInput} type="file" accept=".json,application/json" disabled={!!busy} onChange={event => {
          const file = event.target.files?.[0]; if (file) void run("read", signal => importFile(file, signal));
        }} /></label>
        {retryFile && <button className="button secondary" disabled={!!busy} onClick={() => void run("read", signal => importFile(retryFile, signal, true))}>Retry for five seconds</button>}
        {library.length > 0 && <button className="button secondary" disabled={!!busy}
          onClick={() => downloadText(serializeComponentLibrary(library), "Meridian-component-library.json")}>Download component library</button>}
        {sessionComponents.length > 0 && <button className="button secondary" disabled={!!busy}
          onClick={() => downloadText(serializeComponentLibrary(sessionComponents), "Meridian-session-components.json")}>Download session components</button>}
        {removedDefinition && <div className="dialog-actions" role="group" aria-label="Library removal recovery">
          <button ref={undoRemoval} className="button secondary" disabled={!!busy}
            onClick={() => void run("library", restoreDefinition)}>Undo library removal</button>
          <button className="button quiet" disabled={!!busy} onClick={() =>
            downloadText(JSON.stringify(removedDefinition), "Meridian-removed-component.json")}>Download removed definition</button>
        </div>}
        <ul className="project-list">{choices.map((component, index) => <li key={`${component.id}-${index}`} className="project-row">
          <button id={`component-${component.id}-${component.version}`} className="project-open" disabled={!!busy} onClick={() => select(component)}>
            <span><strong>{component.name}</strong><small>{component.description}</small>
              <small>{count(component.fragment.nodes.length, "node")} · {count(component.fragment.edges.length, "connection")}
                {!!component.fragment.groups.length && ` · ${count(component.fragment.groups.length, "group")}`}</small></span>
          </button>
          {library.includes(component) && <button id={`remove-component-${component.id}-${component.version}`} className="button quiet" disabled={!!busy}
            aria-label={`Remove ${component.name} version ${component.version} ${component.id.slice(0, 8)}`}
            onClick={() => { setRemoveCandidate(component); setError(""); }}>Remove</button>}
        </li>)}</ul>
        {!choices.length && <p>No matching components.</p>}
      </div>}
      {definition && !preview && <div className="heading-form">
        <h3>{definition.name}</h3><p>{definition.description}</p>
        {sessionComponents.includes(definition) && <button className="button secondary" disabled={!!busy}
          onClick={() => downloadText(JSON.stringify(definition), "Meridian-component.json")}>Download session component</button>}
        {definition.parameters.map(parameter => <label key={parameter.id}>{parameter.label}
          {parameter.type === "enum" ? <select value={values[parameter.id] ?? parameter.default} disabled={!!busy}
            onChange={event => setValues(current => ({ ...current, [parameter.id]: event.target.value }))}>
            {parameter.choices.map(choice => <option key={choice}>{choice}</option>)}</select>
            : <input type={parameter.type === "integer" ? "number" : "text"} disabled={!!busy}
              min={parameter.type === "integer" ? parameter.minimum : undefined} max={parameter.type === "integer" ? parameter.maximum : undefined}
              maxLength={parameter.type === "text" ? parameter.maxLength * 2 : undefined}
              value={Number.isNaN(values[parameter.id]) ? "" : values[parameter.id] ?? parameter.default}
              onChange={event => setValues(current => ({ ...current, [parameter.id]: parameter.type === "integer" ? event.target.valueAsNumber : event.target.value }))} />}
        </label>)}
        {definition.ports.length > 0 && <>
          <h4>Attachment points</h4>
          {insertion ? <>
            <label>Find attachment nodes<input value={targetQuery} maxLength={160} disabled={!!busy}
              onChange={event => setTargetQuery(event.target.value)} /></label>
            {definition.ports.map(port => {
              const assignment = attachments.get(port.id);
              const target = assignment === null ? "skip" : assignment?.targetId ?? "";
              const nodes = insertion.nodes.filter(node => node.id === target || node.label.toLowerCase().includes(targetNeedle));
              return <fieldset className="guided-process-fieldset heading-form" key={port.id} disabled={!!busy}>
                <legend>{port.label}</legend>
                <label>Attachment target<select value={target} onChange={event => {
                  const next = new Map(attachments);
                  const id = event.target.value;
                  if (!id) next.delete(port.id);
                  else if (id === "skip") next.set(port.id, null);
                  else next.set(port.id, { targetId: id, direction: port.direction === "either" ? null : port.direction });
                  setAttachments(next);
                }}>
                  <option value="">Choose a node</option>
                  <option value="skip">Leave unconnected</option>
                  {nodes.map(node => <option key={node.id} value={node.id}>{node.label}</option>)}
                  {assignment && !targetIds.has(assignment.targetId) && <option value={assignment.targetId} disabled>Previously chosen node is unavailable</option>}
                </select></label>
                {assignment && port.direction === "either" && <label>Connection direction<select value={assignment.direction ?? ""} onChange={event => {
                  const direction = event.target.value;
                  setAttachments(new Map(attachments).set(port.id, { ...assignment, direction: direction === "in" || direction === "out" ? direction : null }));
                }}>
                  <option value="">Choose direction</option>
                  <option value="in">Into component</option><option value="out">Out of component</option>
                </select></label>}
                {port.direction !== "either" && <small>{port.direction === "in" ? "Into component" : "Out of component"}</small>}
              </fieldset>;
            })}
          </> : <>
            <ul>{definition.ports.map(port => <li key={port.id}>{port.label} · {port.direction}</li>)}</ul>
            <label className="check-label"><input type="checkbox" checked={disconnected} disabled={!!busy}
              onChange={event => setDisconnected(event.target.checked)} /> Leave the ports unconnected in this new project</label>
          </>}
        </>}
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => leaveChoices(() => { setDefinition(undefined); setError(""); })}>Back to components</button>
          <button className="button quiet" disabled={!!busy} onClick={discardCurrentChoices}>Discard component draft</button>
          <button className="button secondary" disabled={!!busy} onClick={() => void run("draft", keepDraft)}>Save component draft</button>
          <button className="button primary" disabled={!!busy || !readyPorts} onClick={() => void run("preview", prepare)}>Preview component</button>
        </div>
      </div>}
      {preview && <div className="migration-preview">
        <h3>Review {definition?.name}</h3>
        <p>{count(preview.graph.nodes.length, "node")} · {count(preview.graph.edges.length, "internal connection")}
          {!!preview.graph.groups.length && ` · ${count(preview.graph.groups.length, "group")}`} · {insertion ? "Current project" : "New project"}</p>
        {insertion && <p>{preview.attachments ?? 0} {preview.attachments === 1 ? "attachment" : "attachments"} to existing nodes</p>}
        {insertion && definition && <ul aria-label="Reviewed attachments">
          {definition.ports.map(port => {
            const choice = attachments.get(port.id);
            return <li key={port.id}>{port.label} · {choice ? `${choice.direction === "in" ? "From" : "To"} ${insertion.nodes.find(node => node.id === choice.targetId)?.label || "current node"}` : "Leave unconnected"}</li>;
          })}
        </ul>}
        <img src={preview.url} alt="Proposed component diagram" onLoad={() => setPainted(true)} onError={() => setError("The proposed diagram could not be displayed.")} />
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => setPreview(undefined)}>Back to component choices</button>
          <button className="button primary" disabled={!!busy || !painted} onClick={() => void run("create", create)}>{insertion ? "Insert reviewed component" : "Create component project"}</button>
        </div>
      </div>}
      {busy && <p role="status">{busy === "read" ? "Reading the local component file…" : busy === "preview" ? "Checking and rendering the component…"
        : busy === "draft" ? "Updating the local component draft…" : busy === "library" ? "Updating the local component library…"
        : insertion ? "Inserting the reviewed component…" : "Saving the new project…"}</p>}
      {!busy && libraryStatus && <p role="status">{libraryStatus}</p>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
