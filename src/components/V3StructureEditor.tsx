import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { buildExportFrame } from "../lib/export";
import { renderMermaidProject } from "../lib/authoring/project-render";
import type { NativeFlowchartEdit } from "../lib/authoring/project-flowchart";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { ConnectionRemovalImpact } from "../lib/authoring/retire-connection";
import { shapeDelimiters, type Shape } from "../lib/authoring/flowchart-source";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Operation = NativeFlowchartEdit["op"];
type NodeChoice = { id: string; label: string };
type Preview = { proposal: ReadyProposal; url: string; impact?: ConnectionRemovalImpact };

export default function V3StructureEditor({ editor, nodes, edges, initialOperation = "addNode", initialTarget = "", onApply, onClose }: {
  editor: Editor;
  nodes: NodeChoice[];
  edges: NodeChoice[];
  initialOperation?: Operation;
  initialTarget?: string;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStructure"]>["status"];
  onClose: () => void;
}) {
  const [operation, setOperation] = useState<Operation>(initialOperation);
  const [shape, setShape] = useState<Shape>("rect");
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(initialTarget);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const work = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => { work.current?.abort(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  function resetPreview() {
    setPreview(undefined);
    setPainted(false);
    setError("");
  }

  async function prepare() {
    if (work.current) return;
    resetPreview();
    const controller = new AbortController();
    work.current = controller;
    setBusy(true);
    try {
      const edit: NativeFlowchartEdit = operation === "addNode" ? { op: operation, shape, label }
        : operation === "setNodeLabel" ? { op: operation, targetId: to, label }
        : operation === "addEdge" ? { op: operation, sourceId: from, targetId: to, label } : { op: operation, targetId: to };
      const proposal = await editor.prepareStructure(edit, controller.signal);
      const candidate = editor.readStructurePreview(proposal);
      if (!candidate) throw new Error("The project changed. Prepare the preview again.");
      const rendered = await renderMermaidProject(candidate, controller.signal);
      controller.signal.throwIfAborted();
      if (!rendered.targetTable) throw new Error("The preview could not verify the diagram targets.");
      const svg = buildExportFrame(rendered.result, candidate).svg;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setPreview({ proposal, url, impact: editor.readStructureImpact(proposal) });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The edit could not be previewed.");
    } finally {
      work.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!preview || !painted) return;
    const status = onApply(preview.proposal);
    if (status === "applied" || status === "unchanged") onClose();
    else {
      resetPreview();
      setError(status === "stale" ? "The project changed. Prepare the preview again." : "This change could not be applied with Undo.");
    }
  }

  const canPreview = operation === "addNode" ? !!label
    : operation === "setNodeLabel" ? !!label && !!to
    : operation === "removeEdge" ? !!to : !!from && !!to;
  const nodeOptions = nodes.map(node => <option value={node.id} key={node.id}>{node.label}</option>);
  return (
    <Modal title="Edit flowchart" wide onClose={onClose}>
      <form className="heading-form" onSubmit={event => { event.preventDefault(); if (canPreview) void prepare(); }}>
        <label>Operation
          <select value={operation} disabled={busy} onChange={event => {
            setOperation(event.target.value as Operation);
            setLabel("");
            setFrom("");
            setTo("");
            resetPreview();
          }}>
            <option value="addNode">Add node</option>
            <option value="setNodeLabel" disabled={!nodes.length}>Rename node</option>
            <option value="addEdge" disabled={!nodes.length}>Connect nodes</option>
            <option value="removeEdge" disabled={!edges.length}>Delete connection</option>
          </select>
        </label>
        {operation === "addNode" && <label>Shape
          <select value={shape} disabled={busy} onChange={event => { setShape(event.target.value as Shape); resetPreview(); }}>
            {Object.keys(shapeDelimiters).map(value => <option key={value} value={value}>{value === "rect" ? "Rectangle" : value}</option>)}
          </select>
        </label>}
        {operation === "addEdge" && <label>From
          <select value={from} disabled={busy} onChange={event => { setFrom(event.target.value); resetPreview(); }}>
            <option value="">Choose a node</option>{nodeOptions}
          </select>
        </label>}
        {(operation === "addEdge" || operation === "setNodeLabel") && <label>{operation === "addEdge" ? "To" : "Node to rename"}
          <select value={to} disabled={busy} onChange={event => { setTo(event.target.value); resetPreview(); }}>
            <option value="">Choose a node</option>{nodeOptions}
          </select>
        </label>}
        {operation === "removeEdge" && <label>Connection to delete
          <select value={to} disabled={busy} onChange={event => { setTo(event.target.value); resetPreview(); }}>
            <option value="">Choose a connection</option>{edges.map(edge => <option value={edge.id} key={edge.id}>{edge.label}</option>)}
          </select>
        </label>}
        {operation !== "removeEdge" && <label>{operation === "addEdge" ? "Connection label (optional)" : "Node label"}
          <input value={label} disabled={busy} onChange={event => { setLabel(event.target.value); resetPreview(); }} />
        </label>}
        {busy && <p role="status">Checking and rendering the proposed diagram…</p>}
        {error && <p role="alert">{error}</p>}
        {preview && (
          <div className="migration-preview">
            <img src={preview.url} alt="Proposed diagram"
              onLoad={() => setPainted(true)}
              onError={() => setError("The proposed diagram could not be displayed. Prepare the preview again.")} />
          </div>
        )}
        {preview?.impact && <section aria-label="Deletion impact">
          <h3>Connection to remove</h3>
          <p>{edges.find(edge => edge.id === to)?.label}</p>
          {!!preview.impact.sceneReferenceCount && <>
            <p>{preview.impact.sceneReferenceCount} scene references will be kept as unresolved annotations.</p>
            <ul>{preview.impact.sceneTitles.map((name, index) => <li key={index}>{name}</li>)}</ul>
          </>}
          {preview.impact.retainsStyle && <p>The connection’s appearance will be kept as an unresolved annotation.</p>}
          {preview.impact.retainsRole && <p>The connection’s role will be kept as an unresolved annotation.</p>}
        </section>}
        <div className="dialog-actions">
          <button className="button quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button secondary" type="submit" disabled={busy || !canPreview}>Preview change</button>
          <button className="button primary" type="button" disabled={!preview || !painted || busy} onClick={apply}>Apply change</button>
        </div>
      </form>
    </Modal>
  );
}
