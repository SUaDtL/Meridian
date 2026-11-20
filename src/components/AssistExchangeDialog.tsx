import { useEffect, useRef, useState } from "react";
import { assistFileLimit, buildAssistRequest, type AssistSelection } from "../lib/authoring/assist-exchange";
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
      const result = await buildAssistRequest(project, table, edgeLabels, selected, instruction);
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
  const visible = allNodes.filter(node => node.label.toLowerCase().includes(query.trim().toLowerCase()));
  const writable = Array.from(selected.values()).filter(choice => choice === "writable").length;
  return <Modal title="External assistant file exchange" wide busy={durableActions.has(busy)} onClose={onClose}>
    {!candidate && !request && <>
      <p>Download a scoped request or review a returned proposal. Meridian keeps this exchange local. This workflow supports one node rename per proposal.</p>
      <div className="dialog-actions">
        <button className="button secondary" aria-pressed={mode === "export"} disabled={!!busy} onClick={() => { setMode("export"); setError(""); }}>Prepare a request</button>
        <button className="button secondary" aria-pressed={mode === "import"} disabled={!!busy} onClick={() => { setMode("import"); setError(""); }}>Review a proposal</button>
      </div>
      {mode === "export" ? <form className="heading-form" onSubmit={event => { event.preventDefault(); reviewRequest(); }}>
        <label>Instruction<textarea rows={3} value={instruction} disabled={!!busy} maxLength={4_000}
          onChange={event => setInstruction(event.target.value)} /></label>
        <label>Find nodes<input value={query} disabled={!!busy} maxLength={200}
          onChange={event => { setQuery(event.target.value); setLimit(batchSize); }} /></label>
        <p>{selected.size} nodes selected · {writable} writable</p>
        <ul className="project-list">
          {visible.slice(0, limit).map(node => <li className="project-row" key={node.id}>
            <label>{node.label}
              <select value={selected.get(node.id) ?? ""} disabled={!!busy} onChange={event => {
                const value = event.target.value;
                setSelected(previous => {
                  const next = new Map(previous);
                  if (value === "context" || value === "writable") next.set(node.id, value);
                  else next.delete(node.id);
                  return next;
                });
              }}>
                <option value="">Exclude</option><option value="context">Read-only context</option><option value="writable">Writable node</option>
              </select>
            </label>
          </li>)}
        </ul>
        {visible.length > limit && <button className="button quiet" type="button" disabled={!!busy}
          onClick={() => setLimit(value => value + batchSize)}>Show more nodes</button>}
        <div className="dialog-actions">
          <button className="button primary" type="submit" disabled={!!busy || !writable || !instruction.trim()}>Review what will be shared</button>
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
      <p>Permitted change is one rename of a writable node.</p>
      <ul>{request.request.graph.nodes.map(node => <li key={node.id}>
        {node.label} · {request.request.scope.writableElementIds.includes(node.id) ? "Writable node" : "Read-only context"}
      </li>)}</ul>
      <details><summary>{request.request.graph.edges.length} declared relationships in the selected scope</summary>
        <ul>{request.request.graph.edges.map(edge => <li key={edge.id}>
          {labels.get(edge.sourceId)} {edge.direction === "both" ? "↔" : edge.direction === "forward" ? "→" : "—"} {labels.get(edge.targetId)}
          {edge.label && ` (${edge.label})`}
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
      <p>Rename {labels.get(candidate.targetId)} to {candidate.label}.</p>
      <img src={candidate.url} alt="Diagram preview with proposed node label" onLoad={() => setPainted(true)}
        onError={() => setError("The candidate diagram could not be displayed.")} />
      <div className="dialog-actions">
        <button className="button quiet" disabled={!!busy} onClick={() => setCandidate(undefined)}>Back to proposal file</button>
        <button className="button primary" disabled={!painted || !!busy} onClick={apply}>Apply reviewed rename</button>
      </div>
    </section>}
    {busy && <p role="status">{busy}…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
