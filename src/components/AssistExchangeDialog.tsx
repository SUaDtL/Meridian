import { useEffect, useRef, useState } from "react";
import { assistFileLimit, assistWritableEdges, buildAssistRequest, type AssistConnectionOperation, type AssistSelection } from "../lib/authoring/assist-exchange";
import type { MermaidProjectV3 } from "../lib/authoring/mermaid-project";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import { downloadBlob } from "../lib/download";
import { buildExportFrame } from "../lib/export";
import { cleanPendingAssist, savePendingAssist } from "../lib/persistence/pending-assist";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type ProposalPreview = Awaited<ReturnType<Editor["prepareAssistSuggestion"]>> & { url: string };
type RequestPreview = Awaited<ReturnType<typeof buildAssistRequest>>;
const batchSize = 30;
const durableActions = new Set(["Saving request", "Applying suggestion"]);

export default function AssistExchangeDialog({ db, editor, project, table, edgeLabels, onApplied, onClose }: {
  db: IDBDatabase; editor: Editor; project: MermaidProjectV3; table: RenderTargetTable; edgeLabels: ReadonlyMap<string, string>;
  onApplied: () => void; onClose: () => void;
}) {
  const [mode, setMode] = useState<"export" | "import">("export");
  const [instruction, setInstruction] = useState("");
  const [selected, setSelected] = useState(new Map<string, AssistSelection>());
  const [writableEdges, setWritableEdges] = useState(new Set<string>());
  const [edgeOperation, setEdgeOperation] = useState<AssistConnectionOperation>("setEdgeLabel");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(batchSize);
  const [request, setRequest] = useState<RequestPreview>();
  const [candidate, setCandidate] = useState<ProposalPreview>();
  const [file, setFile] = useState<File>();
  const [painted, setPainted] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const work = useRef<AbortController | null>(null);
  useEffect(() => () => work.current?.abort(), []);
  useEffect(() => { void cleanPendingAssist(db).catch(() => undefined); }, [db]);
  useEffect(() => () => { if (candidate) URL.revokeObjectURL(candidate.url); }, [candidate]);

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (work.current) return;
    const controller = new AbortController();
    work.current = controller;
    setBusy(label);
    setStatus("");
    setError("");
    try { await action(controller.signal); }
    catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The file exchange could not continue.");
    } finally {
      work.current = null;
      if (!controller.signal.aborted) setBusy("");
    }
  }

  function reviewRequest() {
    void run("Preparing request", async signal => {
      const result = await buildAssistRequest(project, table, edgeLabels, selected, instruction, writableEdges, edgeOperation);
      signal.throwIfAborted();
      if (editor.snapshot() !== project) throw new Error("The project changed. Close this dialog and review the current diagram.");
      setRequest(result);
    });
  }

  function download() {
    if (!request) return;
    void run("Saving request", async signal => {
      if (editor.snapshot() !== project) throw new Error("The project changed. Prepare a new request.");
      await savePendingAssist(db, request.pending);
      signal.throwIfAborted();
      downloadBlob(new Blob([request.text], { type: "application/json" }), `meridian-request-${request.pending.id}.json`);
      setStatus("Request downloaded. Its matching record is available in this browser for 24 hours.");
      setRequest(undefined);
      setInstruction("");
    });
  }

  function reviewSuggestion() {
    if (!file) return;
    void run("Checking suggestion", async signal => {
      if (file.size > assistFileLimit) throw new Error("Choose a proposal no larger than 128 KiB.");
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error("Choose a proposal encoded as UTF-8."); }
      signal.throwIfAborted();
      const result = await editor.prepareAssistSuggestion(text, signal);
      const svg = buildExportFrame(result.preview.result, result.next).svg;
      setPainted(false);
      setCandidate({ ...result, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
      setFile(undefined);
    });
  }

  function apply() {
    if (!candidate || !painted) return;
    void run("Applying suggestion", async () => {
      await editor.applyAssistSuggestion(candidate.proposal);
      onApplied();
    });
  }

  const allNodes = table.targets.filter(node => node.elementKind === "node");
  const labels = new Map(allNodes.map(item => [item.id, item.label]));
  const edgeTargets = new Map(table.targets.filter(item => item.elementKind === "edge").map(item => [item.id, item]));
  const sourceIds = new Map(project.identity.elements.filter(item => item.binding.type === "edge-id")
    .map(item => [item.id, item.binding.sourceId]));
  const eligibleEdges = assistWritableEdges(project, table, selected);
  const visible = allNodes.filter(node => node.label.toLowerCase().includes(query.trim().toLowerCase()));
  const writable = Array.from(selected.values()).filter(choice => choice === "writable").length;
  function connectionName(id: string) {
    const edge = edgeTargets.get(id);
    return edge && edge.sourceId && edge.targetId
      ? `${labels.get(edge.sourceId)} to ${labels.get(edge.targetId)} (${sourceIds.get(id)})`
      : "selected connection";
  }

  function chooseNode(id: string, choice: string) {
    const next = new Map(selected);
    if (choice === "context" || choice === "writable") next.set(id, choice);
    else {
      next.delete(id);
      setWritableEdges(previous => new Set([...previous].filter(edgeId => {
        const edge = edgeTargets.get(edgeId);
        return edge?.sourceId !== id && edge?.targetId !== id;
      })));
    }
    setSelected(next);
  }
  return <Modal title="External assistant file exchange" wide busy={durableActions.has(busy)} onClose={onClose}>
    {!candidate && !request && <>
      <p>Download a scoped request or review a returned proposal. A proposal can edit one label or remove one explicitly authorized connection. Meridian processes the files locally.</p>
      <div className="dialog-actions">
        <button className="button secondary" aria-pressed={mode === "export"} disabled={!!busy} onClick={() => { setMode("export"); setError(""); }}>Prepare a request</button>
        <button className="button secondary" aria-pressed={mode === "import"} disabled={!!busy} onClick={() => { setMode("import"); setError(""); }}>Review a proposal</button>
      </div>
      {mode === "export" ? <form className="heading-form" onSubmit={event => { event.preventDefault(); reviewRequest(); }}>
        <label>Instruction<textarea rows={3} value={instruction} disabled={!!busy} maxLength={4_000}
          onChange={event => setInstruction(event.target.value)} /></label>
        <label>Find nodes<input value={query} disabled={!!busy} maxLength={200}
          onChange={event => { setQuery(event.target.value); setLimit(batchSize); }} /></label>
        <p>{selected.size} nodes selected · {writable} writable nodes · {writableEdges.size} writable connections</p>
        <ul className="project-list">
          {visible.slice(0, limit).map(node => <li className="project-row" key={node.id}>
            <label>{node.label}
              <select value={selected.get(node.id) ?? ""} disabled={!!busy} onChange={event => chooseNode(node.id, event.target.value)}>
                <option value="">Exclude</option><option value="context">Read-only context</option><option value="writable">Writable node</option>
              </select>
            </label>
          </li>)}
        </ul>
        {visible.length > limit && <button className="button quiet" type="button" disabled={!!busy}
          onClick={() => setLimit(value => value + batchSize)}>Show more nodes</button>}
        {eligibleEdges.length > 0 && <fieldset className="guided-process-fieldset" disabled={!!busy}>
          <legend>{edgeOperation === "removeEdge" ? "Connections eligible for removal" : "Writable connection labels"}</legend>
          <label>Allowed connection change<select value={edgeOperation} onChange={event => {
            setEdgeOperation(event.target.value === "removeEdge" ? "removeEdge" : "setEdgeLabel");
            setWritableEdges(new Set());
          }}>
            <option value="setEdgeLabel">Edit label</option>
            <option value="removeEdge">Remove connection</option>
          </select></label>
          {eligibleEdges.length > 200 ? <p>Narrow the selected nodes to review up to 200 relationships.</p>
            : eligibleEdges.map(edge => <label className="check-label" key={edge.id}>
              <input type="checkbox" checked={writableEdges.has(edge.id)} onChange={event => {
                const next = new Set(writableEdges);
                if (event.target.checked) next.add(edge.id);
                else next.delete(edge.id);
                setWritableEdges(next);
              }} />{connectionName(edge.id)}{edgeLabels.get(edge.id) && ` · ${edgeLabels.get(edge.id)}`}
            </label>)}
        </fieldset>}
        <div className="dialog-actions">
          <button className="button primary" type="submit" disabled={!!busy || (!writable && !writableEdges.size) || !instruction.trim()}>Review what will be shared</button>
        </div>
      </form> : <form className="heading-form" onSubmit={event => { event.preventDefault(); reviewSuggestion(); }}>
        <label>Assistant proposal file<input type="file" accept=".json,application/json" disabled={!!busy}
          onChange={event => setFile(event.target.files?.[0])} /></label>
        <div className="dialog-actions"><button type="submit" className="button primary" disabled={!file || !!busy}>Preview unverified suggestion</button></div>
      </form>}
    </>}
    {request && <section className="heading-form" aria-label="What will be shared">
      <h3>What will be shared</h3>
      <p>Instruction</p><blockquote>{request.request.instruction}</blockquote>
      <p>{request.request.allowedOperations.includes("removeEdge") ? "A proposal may remove one connection marked for removal below."
        : "A proposal may change one label on an element marked writable below."}</p>
      {request.request.allowedOperations.includes("removeEdge") && request.request.allowedOperations.includes("setNodeLabel") &&
        <p>It may also rename one writable node as its single change.</p>}
      <ul>{request.request.graph.nodes.map(node => <li key={node.id}>
        {node.label} · {request.request.scope.writableElementIds.includes(node.id) ? "Writable node" : "Read-only context"}
      </li>)}</ul>
      <details open={writableEdges.size > 0 || undefined}><summary>{request.request.graph.edges.length} declared relationships in the selected scope</summary>
        <ul>{request.request.graph.edges.map(edge => <li key={edge.id}>
          {labels.get(edge.sourceId)} {edge.direction === "both" ? "↔" : edge.direction === "forward" ? "→" : "—"} {labels.get(edge.targetId)}
          {edge.label && ` (${edge.label})`} · {request.request.scope.writableElementIds.includes(edge.id)
            ? request.request.allowedOperations.includes("removeEdge") ? "Removal allowed" : "Writable connection" : "Read-only context"}
        </li>)}</ul>
      </details>
      <details><summary>Exact request JSON</summary><pre tabIndex={0} style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{request.text}</pre></details>
      <div className="dialog-actions">
        <button className="button quiet" disabled={!!busy} onClick={() => setRequest(undefined)}>Back to scope</button>
        <button className="button primary" disabled={!!busy} onClick={download}>Download request</button>
      </div>
    </section>}
    {candidate && <section className="migration-preview" aria-label="Unverified suggestion">
      <h3>Unverified suggestion</h3>
      {candidate.op === "setNodeLabel" ? <p>Rename {labels.get(candidate.targetId)} to {candidate.label}.</p>
        : candidate.op === "removeEdge" ? <p>Remove {connectionName(candidate.targetId)}
          {edgeLabels.get(candidate.targetId) && ` · ${edgeLabels.get(candidate.targetId)}`}.</p>
        : <p>{candidate.label ? <>Set the label of {connectionName(candidate.targetId)} to {candidate.label}.</>
          : <>Clear the label of {connectionName(candidate.targetId)}.</>}</p>}
      {candidate.op === "removeEdge" && candidate.impact && <section aria-label="Retained annotations">
        <p>{candidate.impact.sceneReferenceCount} scene references and {candidate.impact.styleCount} style records will remain as unresolved annotations.</p>
        {candidate.impact.sceneTitles.length > 0 && <ul aria-label="Affected scenes">
          {candidate.impact.sceneTitles.map((title, index) => <li key={index}>{title}</li>)}
        </ul>}
      </section>}
      <img src={candidate.url} alt={candidate.op === "setNodeLabel" ? "Diagram preview with proposed node label"
        : candidate.op === "removeEdge" ? "Diagram preview after proposed connection removal" : "Diagram preview with proposed connection label"}
        onLoad={() => setPainted(true)}
        onError={() => setError("The candidate diagram could not be displayed.")} />
      <div className="dialog-actions">
        <button className="button quiet" disabled={!!busy} onClick={() => setCandidate(undefined)}>Back to proposal file</button>
        <button className="button primary" disabled={!painted || !!busy} onClick={apply}>
          {candidate.op === "setNodeLabel" ? "Apply reviewed rename"
            : candidate.op === "removeEdge" ? "Apply reviewed connection removal" : "Apply reviewed connection label"}
        </button>
      </div>
    </section>}
    {busy && <p role="status">{busy}…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
