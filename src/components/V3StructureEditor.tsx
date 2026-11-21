import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { buildExportFrame } from "../lib/export";
import { renderMermaidProject } from "../lib/authoring/project-render";
import type { DecisionBranch, NativeFlowchartEdit } from "../lib/authoring/project-flowchart";
import type { SemanticRole } from "../lib/authoring/mermaid-project";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { ElementRemovalImpact } from "../lib/authoring/retire-elements";
import { shapeDelimiters, type ConnectionDirection, type Shape } from "../lib/authoring/flowchart-source";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Operation = NativeFlowchartEdit["op"];
type NodeChoice = { id: string; label: string };
type EdgeChoice = NodeChoice & { sourceId: string | null; targetId: string | null; explicit: boolean; text: string; direction: ConnectionDirection | null };
type Preview = { proposal: ReadyProposal; url: string; impact?: ElementRemovalImpact };
type EditDestination = { operation: Operation } | { target: string };
const nextRoles: readonly SemanticRole[] = ["process", "decision", "neutral", "service", "database", "queue", "external", "person"];
const emptyBranches = (): DecisionBranch[] => [
  { label: "", destination: { kind: "existing", id: "" } },
  { label: "", destination: { kind: "existing", id: "" } },
];

export default function V3StructureEditor({ editor, nodes, edges, group, movableNodes, flatFlowchart, canEditLabels, canUngroup,
  initialOperation = "addNode", initialTarget = "",
  deleteConnections, groupMembers, groupRemoval, onApply, onClose }: {
  editor: Editor;
  nodes: (NodeChoice & { text: string })[];
  edges: EdgeChoice[];
  group?: NodeChoice;
  movableNodes: NodeChoice[];
  flatFlowchart: boolean;
  canEditLabels: boolean;
  canUngroup: boolean;
  initialOperation?: Operation;
  initialTarget?: string;
  deleteConnections?: { ids: string[]; hidden: number };
  groupMembers?: { ids: string[]; hidden: number };
  groupRemoval?: { members: { id: string; label: string; kind: string }[]; connectionIds: string[]; unavailable?: string };
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStructure"]>["status"];
  onClose: () => void;
}) {
  const [operation, setOperation] = useState<Operation>(initialOperation);
  const [shape, setShape] = useState<Shape>("rect");
  const [label, setLabel] = useState(() => initialOperation === "setNodeLabel" ? nodes.find(node => node.id === initialTarget)?.text ?? ""
    : initialOperation === "setEdgeLabel" ? edges.find(edge => edge.id === initialTarget)?.text ?? "" : "");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [incoming, setIncoming] = useState(false);
  const [role, setRole] = useState<SemanticRole | "">("");
  const [nodeQuery, setNodeQuery] = useState("");
  const [edgeDirection, setEdgeDirection] = useState<ConnectionDirection>("forward");
  const [approvedDuplicate, setApprovedDuplicate] = useState("");
  const [from, setFrom] = useState(initialOperation === "addEdge" ? initialTarget : "");
  const [to, setTo] = useState(initialOperation === "removeGroup" || initialOperation === "removeGroupContents"
    ? group?.id ?? "" : initialOperation === "addEdge" ? "" : initialTarget);
  const [members, setMembers] = useState<ReadonlySet<string>>(() => new Set(groupMembers?.ids));
  const [branches, setBranches] = useState(emptyBranches);
  const [showSecondBranchFirst, setShowSecondBranchFirst] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [destination, setDestination] = useState<EditDestination>();
  const work = useRef<AbortController | undefined>(undefined);
  const operationField = useRef<HTMLSelectElement>(null);
  const targetField = useRef<HTMLSelectElement>(null);
  const labelField = useRef<HTMLInputElement>(null);
  const keepDraft = useRef<HTMLButtonElement>(null);
  const applyButton = useRef<HTMLButtonElement>(null);
  const labelChoices = operation === "setNodeLabel" ? nodes : operation === "setEdgeLabel" ? edges : undefined;
  const originalLabel = labelChoices?.find(item => item.id === to)?.text;
  const dirtyLabel = originalLabel !== undefined && label !== originalLabel;
  const removingNode = operation === "removeNode";
  const removingEdges = operation === "removeEdges";
  const selectedEdges = deleteConnections?.ids.map(id => edges.find(edge => edge.id === id && edge.explicit));
  const grouping = operation === "addGroup";
  const selectedMembers = groupMembers?.ids.map(id => nodes.find(node => node.id === id));
  const ungrouping = operation === "removeGroup";
  const deletingGroup = operation === "removeGroupContents";
  const movingToGroup = operation === "moveToGroup";
  const displayedBranches = (showSecondBranchFirst ? [1, 0] : [0, 1]).map(index => ({ index, branch: branches[index] }));
  const incident = (removingNode || movingToGroup) && to ? edges.filter(edge => edge.sourceId === to || edge.targetId === to) : [];
  const unidentified = incident.filter(edge => !edge.explicit);
  const boundary = grouping ? edges.filter(edge =>
    members.has(edge.sourceId ?? "") !== members.has(edge.targetId ?? "")) : [];

  const duplicateKey = operation === "addEdge" && from && to && edges.some(edge => {
    const sameEndpoints = (edge.sourceId === from && edge.targetId === to)
      || (edgeDirection !== "forward" && edge.sourceId === to && edge.targetId === from);
    return sameEndpoints && edge.text === label && edge.direction === edgeDirection;
  }) ? JSON.stringify([from, to, edgeDirection, label]) : "";

  useEffect(() => () => { work.current?.abort(); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  function resetPreview() {
    setPreview(undefined);
    setPainted(false);
    setError("");
  }

  function switchTo(next: EditDestination) {
    setDestination(undefined);
    resetPreview();
    if ("target" in next) {
      setTo(next.target);
      if (labelChoices) setLabel(labelChoices.find(item => item.id === next.target)?.text ?? "");
      return;
    }
    setOperation(next.operation);
    setLabel("");
    setEdgeLabel("");
    setIncoming(false);
    setEdgeDirection("forward");
    setNodeQuery("");
    setApprovedDuplicate("");
    setRole("");
    setFrom("");
    setTo(next.operation === "removeGroup" || next.operation === "removeGroupContents" ? group?.id ?? "" : "");
    setMembers(new Set());
    setBranches(emptyBranches());
    setShowSecondBranchFirst(false);
  }

  function requestSwitch(next: EditDestination) {
    if (dirtyLabel) {
      setDestination(next);
      requestAnimationFrame(() => keepDraft.current?.focus());
    } else switchTo(next);
  }

  function continueTo(next: EditDestination) {
    switchTo(next);
    requestAnimationFrame(() => ("target" in next ? targetField : operationField).current?.focus());
  }

  function editBranch(index: number, branch: DecisionBranch) {
    setBranches(current => current.map((item, i) => i === index ? branch : item));
    resetPreview();
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
        : operation === "addDecision" ? { op: operation, anchorId: from || undefined, label, branches }
        : (operation === "setNodeLabel" || operation === "setEdgeLabel") ? { op: operation, targetId: to, label }
        : operation === "addEdge" ? { op: operation, sourceId: from, targetId: to, label, direction: edgeDirection }
        : operation === "addGroup" ? { op: operation, memberIds: [...members], label }
        : operation === "moveToGroup" ? { op: operation, targetId: to, groupId: group?.id ?? "" }
        : operation === "removeGroupContents" ? { op: operation, targetId: to, memberIds: groupRemoval?.members.map(item => item.id) ?? [],
          incidentEdgeIds: groupRemoval?.connectionIds ?? [] }
        : operation === "removeNode" ? { op: operation, targetId: to, incidentEdgeIds: incident.map(edge => edge.id) }
        : operation === "removeEdges" ? { op: operation, targetIds: deleteConnections?.ids ?? [] }
        : { op: operation, targetId: to };
      const proposal = await editor.prepareStructure(edit, controller.signal);
      const candidate = editor.readStructurePreview(proposal);
      if (!candidate) throw new Error("The project changed. Prepare the preview again.");
      const rendered = await renderMermaidProject(candidate, controller.signal, "preview");
      controller.signal.throwIfAborted();
      if (!rendered.targetTable) throw new Error("The preview could not verify the diagram targets.");
      const svg = buildExportFrame(rendered.result, candidate).svg;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      setPreview({ proposal, url, impact: editor.readStructureImpact(proposal) });
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : "The edit could not be previewed.");
        if (destination) requestAnimationFrame(() => labelField.current?.focus());
      }
    } finally {
      work.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!preview || !painted) return;
    const status = onApply(preview.proposal);
    if (status === "applied" || status === "unchanged") {
      if (destination) continueTo(destination);
      else onClose();
    } else {
      resetPreview();
      setError(status === "stale" ? "The project changed. Prepare the preview again." : "This change could not be applied with Undo.");
    }
  }

  const canPreview = operation === "addNode" ? !!label
    : operation === "addNext" ? !!label && !!from
    : operation === "addDecision" ? !!label.trim() && branches.every(branch => branch.label.trim() && (
      branch.destination.kind === "existing" ? !!branch.destination.id : !!branch.destination.label.trim()))
    : operation === "setNodeLabel" ? !!label && !!to
    : operation === "addGroup" ? !!label && members.size > 0 && (!selectedMembers || selectedMembers.every(Boolean))
    : operation === "removeGroup" ? !!to
    : deletingGroup ? !!to && !!groupRemoval && !groupRemoval.unavailable
    : movingToGroup ? !!group && movableNodes.some(node => node.id === to)
    : (operation === "removeEdge" || operation === "setEdgeLabel") ? !!to
    : removingEdges ? !!selectedEdges?.length && selectedEdges.every(Boolean)
    : operation === "removeNode" ? !!to && !unidentified.length : !!from && !!to && (!duplicateKey || approvedDuplicate === duplicateKey);
  const search = operation === "addEdge" ? nodeQuery.trim().toLowerCase() : "";
  const nodeOptions = nodes.filter(node => !search || node.id === from || node.id === to || node.label.toLowerCase().includes(search))
    .map(node => <option value={node.id} key={node.id}>{node.label}</option>);
  return (
    <Modal title="Edit flowchart" wide onClose={onClose}>
      <form className="heading-form" onSubmit={event => {
        event.preventDefault();
        if (destination && preview && painted) applyButton.current?.focus();
        else if (canPreview) void prepare();
      }}>
        <label>Operation
          <select ref={operationField} value={operation} disabled={busy || !!groupMembers || !!destination}
            onChange={event => requestSwitch({ operation: event.target.value as Operation })}>
            {removingEdges ? <option value="removeEdges">Delete selected connections</option> : <>
              {flatFlowchart && <>
                <option value="addNode">Add node</option>
                <option value="addNext" disabled={!nodes.length}>Add next</option>
                <option value="addDecision">Add decision</option>
              </>}
              {canEditLabels && <>
                <option value="setNodeLabel" disabled={!nodes.length}>Rename node</option>
                <option value="setEdgeLabel" disabled={!edges.some(edge => edge.explicit)}>Edit connection label</option>
              </>}
              {flatFlowchart && <>
                <option value="addEdge" disabled={!nodes.length}>Connect nodes</option>
                <option value="removeEdge" disabled={!edges.some(edge => edge.explicit)}>Delete connection</option>
                <option value="removeNode" disabled={nodes.length < 2}>Delete node</option>
              </>}
              {(flatFlowchart || groupMembers) && <option value="addGroup" disabled={!nodes.length}>Create group</option>}
              {group && <>
                {canUngroup && <option value="removeGroup">Ungroup</option>}
                {groupRemoval && <option value="removeGroupContents" disabled={!!groupRemoval.unavailable}>Delete group and contents</option>}
                {!!movableNodes.length && <option value="moveToGroup">Move node into group</option>}
              </>}
            </>}
          </select>
        </label>
        {destination && <section className="heading-form" aria-label="Unsaved label edit">
          <p>Save or discard the edited label before {"operation" in destination ? "changing operations" : "choosing another element"}.</p>
          <div className="dialog-actions">
            <button type="button" className="button quiet" ref={keepDraft} disabled={busy} onClick={() => {
              setDestination(undefined);
              requestAnimationFrame(() => labelField.current?.focus());
            }}>Keep editing</button>
            <button type="button" className="button secondary" disabled={busy} onClick={() => continueTo(destination)}>Discard label and continue</button>
            <button type="submit" className="button primary" disabled={busy || !canPreview}>Review label before saving</button>
          </div>
        </section>}
        {(operation === "addNode" || operation === "addNext") && <label>Shape
          <select value={shape} disabled={busy} onChange={event => { setShape(event.target.value as Shape); resetPreview(); }}>
            {Object.keys(shapeDelimiters).map(value => <option key={value} value={value}>{value === "rect" ? "Rectangle" : value}</option>)}
          </select>
        </label>}
        {operation === "addEdge" && <label>Find connection endpoints
          <input value={nodeQuery} maxLength={160} disabled={busy} onChange={event => setNodeQuery(event.target.value)} />
        </label>}
        {(operation === "addEdge" || operation === "addNext") && <label>{operation === "addNext" ? "Connect to this node" : "From"}
          <select value={from} disabled={busy} onChange={event => { setFrom(event.target.value); resetPreview(); }}>
            <option value="">Choose a node</option>{nodeOptions}
          </select>
        </label>}
        {(operation === "addEdge" || operation === "setNodeLabel") && <label>{operation === "addEdge" ? "To" : "Node to rename"}
          <select ref={targetField} value={to} disabled={busy || !!destination}
            onChange={event => requestSwitch({ target: event.target.value })}>
            <option value="">Choose a node</option>{nodeOptions}
          </select>
        </label>}
        {(operation === "removeEdge" || operation === "setEdgeLabel") && <label>{operation === "removeEdge" ? "Connection to delete" : "Connection to edit"}
          <select ref={targetField} value={to} disabled={busy || !!destination}
            onChange={event => requestSwitch({ target: event.target.value })}>
            <option value="">Choose a connection</option>{edges.filter(edge => edge.explicit).map(edge => <option value={edge.id} key={edge.id}>{edge.label}</option>)}
          </select>
        </label>}
        {removingNode && <label>Node to delete
          <select value={to} disabled={busy} onChange={event => { setTo(event.target.value); resetPreview(); }}>
            <option value="">Choose a node</option>{nodeOptions}
          </select>
        </label>}
        {removingNode && !!unidentified.length && <p role="status">Each incident connection needs an explicit source ID before this node can be deleted.</p>}
        {movingToGroup && <label>Node to move into {group?.label}
          <select value={to} disabled={busy} onChange={event => { setTo(event.target.value); resetPreview(); }}>
            <option value="">Choose a node</option>
            {movableNodes.map(node => <option value={node.id} key={node.id}>{node.label}</option>)}
          </select>
        </label>}
        {operation !== "removeEdge" && !removingEdges && !removingNode && !ungrouping && !movingToGroup && !deletingGroup && <label>{(operation === "addEdge" || operation === "setEdgeLabel")
          ? "Connection label (optional)" : grouping ? "Group label" : operation === "addDecision" ? "Decision label" : "Node label"}
          <input ref={labelField} value={label} disabled={busy} onChange={event => { setLabel(event.target.value); resetPreview(); }} />
        </label>}
        {operation === "addDecision" && <>
          <label>Connect from this node (optional)<select value={from} disabled={busy}
            onChange={event => { setFrom(event.target.value); resetPreview(); }}>
            <option value="">No incoming connection</option>{nodeOptions}
          </select></label>
          <button className="button quiet" type="button" disabled={busy} aria-pressed={showSecondBranchFirst}
            onClick={() => setShowSecondBranchFirst(value => !value)}>Show second branch first</button>
          {displayedBranches.map(({ branch, index }) => <fieldset key={index} className="guided-process-fieldset" disabled={busy}>
            <legend>Branch {index + 1}</legend>
            <label>Connection label<input maxLength={400} value={branch.label}
              onChange={event => editBranch(index, { ...branch, label: event.target.value })} /></label>
            <label>Destination type<select value={branch.destination.kind} onChange={event => editBranch(index, {
              ...branch, destination: event.target.value === "new" ? { kind: "new", label: "" } : { kind: "existing", id: "" },
            })}><option value="existing">Existing node</option><option value="new">New step</option></select></label>
            {branch.destination.kind === "existing"
              ? <label>Destination node<select value={branch.destination.id}
                onChange={event => editBranch(index, { ...branch, destination: { kind: "existing", id: event.target.value } })}>
                <option value="">Choose a node</option>{nodeOptions}
              </select></label>
              : <label>New step label<input maxLength={400} value={branch.destination.label}
                onChange={event => editBranch(index, { ...branch, destination: { kind: "new", label: event.target.value } })} /></label>}
          </fieldset>)}
        </>}
        {operation === "addEdge" && <>
          <label>Connection direction<select value={edgeDirection} disabled={busy} onChange={event => {
            setEdgeDirection(event.target.value as ConnectionDirection);
            resetPreview();
          }}>
            <option value="forward">From → To</option>
            <option value="both">Both ways</option>
            <option value="none">No arrows</option>
          </select></label>
          {from && from === to && <p>This connection returns to the same node.</p>}
          {duplicateKey && <label className="check-label"><input type="checkbox" checked={approvedDuplicate === duplicateKey} disabled={busy}
            onChange={event => { setApprovedDuplicate(event.target.checked ? duplicateKey : ""); resetPreview(); }} /> Add another identical connection</label>}
        </>}
        {grouping && groupMembers && <section aria-label="Selected group members">
          <p>{groupMembers.ids.length} selected · {groupMembers.hidden} hidden in the outline</p>
          <ul>{selectedMembers?.map((node, index) => <li key={groupMembers.ids[index]}>{node?.label || "Node unavailable"}</li>)}</ul>
          <p>Group consecutive node declarations. Close this review to change the selection.</p>
        </section>}
        {grouping && !groupMembers && <fieldset className="guided-process-fieldset" disabled={busy}>
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
        {ungrouping && <p>Ungroup {group?.label}. Its members and connections will stay in the diagram.</p>}
        {deletingGroup && groupRemoval && <section aria-label="Group contents to delete">
          {!groupRemoval.unavailable && <>
            <p>Delete {group?.label} and all listed elements.</p>
            <ul aria-label="Nodes to delete">{nodes.filter(item => groupRemoval.members.some(member => member.id === item.id))
              .map(item => <li key={item.id}>{item.label}</li>)}</ul>
            {groupRemoval.members.some(item => item.kind === "group") && <ul aria-label="Nested groups to delete">
              {groupRemoval.members.filter(item => item.kind === "group").map(item => <li key={item.id}>{item.label}</li>)}
            </ul>}
            {!!groupRemoval.connectionIds.length && <ul aria-label="Connections to delete">
              {edges.filter(item => groupRemoval.connectionIds.includes(item.id)).map(item => <li key={item.id}>{item.label}</li>)}
            </ul>}
          </>}
          {groupRemoval.unavailable && <p role="alert">{groupRemoval.unavailable}</p>}
        </section>}
        {removingEdges && <section aria-label="Connections to delete">
          <p>{deleteConnections?.ids.length} selected · {deleteConnections?.hidden} hidden in the outline</p>
          <ul>{selectedEdges?.map((edge, index) => <li key={deleteConnections?.ids[index]}>{edge?.label || "Connection unavailable"}</li>)}</ul>
          <p>The edit preserves the endpoint nodes. You can restore the connections with Undo.</p>
        </section>}
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
              onLoad={() => {
                setPainted(true);
                if (destination) requestAnimationFrame(() => applyButton.current?.focus());
              }}
              onError={() => setError("The proposed diagram could not be displayed. Prepare the preview again.")} />
          </div>
        )}
        {preview?.impact && <section aria-label="Deletion impact">
          <h3>{removingEdges || deletingGroup ? "Retained annotations" : ungrouping ? "Group container to remove" : removingNode ? "Node to remove" : "Connection to remove"}</h3>
          {!removingEdges && !deletingGroup && <p>{ungrouping ? group?.label : (removingNode ? nodes : edges).find(item => item.id === to)?.label}</p>}
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
        {preview && movingToGroup && <section aria-label="Group move impact">
          <p>{movableNodes.find(node => node.id === to)?.label} will join {group?.label}.</p>
          {incident.length ? <ul aria-label="Connections retained">
            {incident.map(edge => <li key={edge.id}>{edge.label}</li>)}
          </ul> : <p>This node has no connections.</p>}
        </section>}
        {preview && operation === "addDecision" && <section aria-label="Decision connections">
          {from && <p>Incoming connection from {nodes.find(node => node.id === from)?.label}.</p>}
          <ul>{displayedBranches.map(({ branch: { label: edge, destination }, index }) => <li key={index}>{edge} → {destination.kind === "new"
            ? `${destination.label} (new step)` : nodes.find(node => node.id === destination.id)?.label}</li>)}</ul>
        </section>}
        <div className="dialog-actions">
          <button className="button quiet" type="button" onClick={onClose}>Cancel</button>
          {!destination && <button className="button secondary" type="submit" disabled={busy || !canPreview}>Preview change</button>}
          <button className="button primary" type="button" ref={applyButton} disabled={!preview || !painted || busy}
            onClick={apply}>{destination ? "Save label and continue" : "Apply change"}</button>
        </div>
      </form>
    </Modal>
  );
}
