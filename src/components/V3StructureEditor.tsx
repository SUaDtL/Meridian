import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { buildExportFrame } from "../lib/export";
import { renderMermaidProject } from "../lib/authoring/project-render";
import type { NativeFlowchartEdit } from "../lib/authoring/project-flowchart";
import type { SemanticRole } from "../lib/authoring/mermaid-project";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { ElementRemovalImpact } from "../lib/authoring/retire-elements";
import { shapeDelimiters, type Shape } from "../lib/authoring/flowchart-source";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Operation = NativeFlowchartEdit["op"];
type NodeChoice = { id: string; label: string };
type EdgeChoice = NodeChoice & { sourceId: string | null; targetId: string | null; explicit: boolean };
type Preview = { proposal: ReadyProposal; url: string; impact?: ElementRemovalImpact };
const nextRoles: readonly SemanticRole[] = ["process", "decision", "neutral", "service", "database", "queue", "external", "person"];

export default function V3StructureEditor({ editor, nodes, edges, group, initialOperation = "addNode", initialTarget = "", onApply, onClose }: {
  editor: Editor;
  nodes: NodeChoice[];
  edges: EdgeChoice[];
  group?: NodeChoice;
  initialOperation?: Operation;
  initialTarget?: string;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStructure"]>["status"];
  onClose: () => void;
}) {
  const [operation, setOperation] = useState<Operation>(initialOperation);
  const [shape, setShape] = useState<Shape>("rect");
  const [label, setLabel] = useState("");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [incoming, setIncoming] = useState(false);
  const [role, setRole] = useState<SemanticRole | "">("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(initialOperation === "removeGroup" ? group?.id ?? "" : initialTarget);
  const [members, setMembers] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const work = useRef<AbortController | undefined>(undefined);
  const removingNode = operation === "removeNode";
  const grouping = operation === "addGroup";
  const ungrouping = operation === "removeGroup";
  const incident = removingNode && to ? edges.filter(edge => edge.sourceId === to || edge.targetId === to) : [];
  const unidentified = incident.filter(edge => !edge.explicit);
  const boundary = grouping ? edges.filter(edge =>
    members.has(edge.sourceId ?? "") !== members.has(edge.targetId ?? "")) : [];

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
        : operation === "addNext" ? { op: operation, anchorId: from, shape, label, edgeLabel, incoming, role: role || undefined }
        : operation === "setNodeLabel" ? { op: operation, targetId: to, label }
        : operation === "addEdge" ? { op: operation, sourceId: from, targetId: to, label }
        : operation === "addGroup" ? { op: operation, memberIds: [...members], label }
        : operation === "removeNode" ? { op: operation, targetId: to, incidentEdgeIds: incident.map(edge => edge.id) }
        : { op: operation, targetId: to };
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
    : operation === "addNext" ? !!label && !!from
    : operation === "setNodeLabel" ? !!label && !!to
    : operation === "addGroup" ? !!label && members.size > 0
    : operation === "removeGroup" ? !!to
    : operation === "removeEdge" ? !!to
    : operation === "removeNode" ? !!to && !unidentified.length : !!from && !!to;
  const nodeOptions = nodes.map(node => <option value={node.id} key={node.id}>{node.label}</option>);
  return (
    <Modal title="Edit flowchart" wide onClose={onClose}>
      <form className="heading-form" onSubmit={event => { event.preventDefault(); if (canPreview) void prepare(); }}>
        <label>Operation
          <select value={operation} disabled={busy} onChange={event => {
            setOperation(event.target.value as Operation);
            setLabel("");
            setEdgeLabel("");
            setIncoming(false);
            setRole("");
            setFrom("");
            setTo("");
            setMembers(new Set());
            resetPreview();
          }}>
            {group ? <option value="removeGroup">Ungroup</option> : <>
              <option value="addNode">Add node</option>
              <option value="addNext" disabled={!nodes.length}>Add next</option>
              <option value="setNodeLabel" disabled={!nodes.length}>Rename node</option>
              <option value="addEdge" disabled={!nodes.length}>Connect nodes</option>
              <option value="addGroup" disabled={!nodes.length}>Create group</option>
              <option value="removeEdge" disabled={!edges.some(edge => edge.explicit)}>Delete connection</option>
              <option value="removeNode" disabled={nodes.length < 2}>Delete node</option>
            </>}
          </select>
        </label>
        {(operation === "addNode" || operation === "addNext") && <label>Shape
          <select value={shape} disabled={busy} onChange={event => { setShape(event.target.value as Shape); resetPreview(); }}>
            {Object.keys(shapeDelimiters).map(value => <option key={value} value={value}>{value === "rect" ? "Rectangle" : value}</option>)}
          </select>
        </label>}
        {(operation === "addEdge" || operation === "addNext") && <label>{operation === "addNext" ? "Connect to this node" : "From"}
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
            <option value="">Choose a connection</option>{edges.filter(edge => edge.explicit).map(edge => <option value={edge.id} key={edge.id}>{edge.label}</option>)}
          </select>
        </label>}
        {removingNode && <label>Node to delete
          <select value={to} disabled={busy} onChange={event => { setTo(event.target.value); resetPreview(); }}>
            <option value="">Choose a node</option>{nodeOptions}
          </select>
        </label>}
        {!!unidentified.length && <p role="status">Each incident connection needs an explicit source ID before this node can be deleted.</p>}
        {operation !== "removeEdge" && !removingNode && !ungrouping && <label>{operation === "addEdge" ? "Connection label (optional)" : grouping ? "Group label" : "Node label"}
          <input value={label} disabled={busy} onChange={event => { setLabel(event.target.value); resetPreview(); }} />
        </label>}
        {grouping && <fieldset className="guided-process-fieldset" disabled={busy}>
          <legend>Group members</legend>
          <p>Choose consecutive node declarations. Ungroup returns the nodes to the top level.</p>
          {nodes.map(node => <label key={node.id} className="check-label">
            <input type="checkbox" checked={members.has(node.id)} onChange={event => {
              const next = new Set(members);
              if (event.target.checked) next.add(node.id);
              else next.delete(node.id);
              setMembers(next);
              resetPreview();
            }} /> {node.label}
          </label>)}
        </fieldset>}
        {ungrouping && <p>Ungroup {group?.label}. The member nodes and all connections will stay in the diagram.</p>}
        {operation === "addNext" && <>
          <label>Connection direction<select value={incoming ? "incoming" : "outgoing"} disabled={busy}
            onChange={event => { setIncoming(event.target.value === "incoming"); resetPreview(); }}>
            <option value="outgoing">Existing node → new node</option><option value="incoming">New node → existing node</option>
          </select></label>
          <label>Connection label (optional)<input value={edgeLabel} disabled={busy}
            onChange={event => { setEdgeLabel(event.target.value); resetPreview(); }} /></label>
          <label>Node role<select value={role} disabled={busy} onChange={event => { setRole(event.target.value as SemanticRole | ""); resetPreview(); }}>
            <option value="">No role</option>{nextRoles.map(item => <option key={item} value={item}>{item[0].toUpperCase() + item.slice(1)}</option>)}
          </select></label>
        </>}
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
          <h3>{ungrouping ? "Group container to remove" : removingNode ? "Node to remove" : "Connection to remove"}</h3>
          <p>{ungrouping ? group?.label : (removingNode ? nodes : edges).find(item => item.id === to)?.label}</p>
          {removingNode && <>
            <h4>Incident connections to remove ({incident.length})</h4>
            {!!incident.length && <ul>{incident.map(edge => <li key={edge.id}>{edge.label}</li>)}</ul>}
          </>}
          {!!preview.impact.sceneReferenceCount && <>
            <p>{preview.impact.sceneReferenceCount} scene references will be kept as unresolved annotations.</p>
            <ul>{preview.impact.sceneTitles.map((name, index) => <li key={index}>{name}</li>)}</ul>
          </>}
          {!!preview.impact.styleCount && <p>Appearance settings for {preview.impact.styleCount} removed {preview.impact.styleCount === 1 ? "element" : "elements"} will be kept as unresolved annotations.</p>}
          {!!preview.impact.roleCount && <p>Roles for {preview.impact.roleCount} removed {preview.impact.roleCount === 1 ? "element" : "elements"} will be kept as unresolved annotations.</p>}
        </section>}
        {preview && grouping && <section aria-label="Group impact">
          <h3>Members and external connections</h3>
          <ul>{nodes.filter(node => members.has(node.id)).map(node => <li key={node.id}>{node.label}</li>)}</ul>
          {boundary.length > 0 ? <ul aria-label="Connections crossing the group">
            {boundary.map(edge => <li key={edge.id}>{edge.label}</li>)}
          </ul> : <p>No connections cross this group.</p>}
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
