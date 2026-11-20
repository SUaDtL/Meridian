import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { buildExportFrame } from "../lib/export";
import { renderMermaidProject } from "../lib/authoring/project-render";
import type { NativeFlowchartEdit } from "../lib/authoring/project-flowchart";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { shapeDelimiters, type Shape } from "../lib/authoring/flowchart-source";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Operation = NativeFlowchartEdit["op"];
type NodeChoice = { id: string; label: string };
type Preview = { proposal: ReadyProposal; url: string };

export default function V3StructureEditor({ editor, nodes, initialOperation = "addNode", initialTarget = "", onApply, onClose }: {
  editor: Editor;
  nodes: NodeChoice[];
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
        : { op: operation, sourceId: from, targetId: to, label };
      const proposal = await editor.prepareStructure(edit, controller.signal);
      const candidate = editor.readStructurePreview(proposal);
      if (!candidate) throw new Error("The project changed. Prepare the preview again.");
      const rendered = await renderMermaidProject(candidate, controller.signal);
      controller.signal.throwIfAborted();
      if (!rendered.targetTable) throw new Error("The preview could not verify the diagram targets.");
      const svg = buildExportFrame(rendered.result, candidate).svg;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setPreview({ proposal, url });
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
    : !!from && !!to;
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
        {operation !== "addNode" && <label>{operation === "addEdge" ? "To" : "Node to rename"}
          <select value={to} disabled={busy} onChange={event => { setTo(event.target.value); resetPreview(); }}>
            <option value="">Choose a node</option>{nodeOptions}
          </select>
        </label>}
        <label>{operation === "addEdge" ? "Connection label (optional)" : "Node label"}
          <input value={label} disabled={busy} onChange={event => { setLabel(event.target.value); resetPreview(); }} />
        </label>
        {busy && <p role="status">Checking and rendering the proposed diagram…</p>}
        {error && <p role="alert">{error}</p>}
        {preview && (
          <div className="migration-preview">
            <img src={preview.url} alt="Proposed diagram"
              onLoad={() => setPainted(true)}
              onError={() => setError("The proposed diagram could not be displayed. Prepare the preview again.")} />
          </div>
        )}
        <div className="dialog-actions">
          <button className="button quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="button secondary" type="submit" disabled={busy || !canPreview}>Preview change</button>
          <button className="button primary" type="button" disabled={!preview || !painted || busy} onClick={apply}>Apply change</button>
        </div>
      </form>
    </Modal>
  );
}
