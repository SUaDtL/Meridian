import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { shapeDelimiters } from "../lib/authoring/flowchart-source";
import { prepareGuidedFlowchart } from "../lib/authoring/guided-flowchart";
import type { GuidedAttachment } from "../lib/authoring/guided-systems-insertion";
import GuidedAttachmentPicker, { emptyGuidedAttachment, GuidedAttachmentSummary, readyGuidedAttachment, type GuidedAttachmentTarget } from "./GuidedAttachmentPicker";
import type { MermaidProjectV3 } from "../lib/authoring/mermaid-project";
import type { ReadyProposal } from "../lib/authoring/proposals";
import type { RenderResult } from "../types";
import { systemRoles } from "../lib/authoring/relationship-table";
import { normalizeSystemsDraft, type SystemConnection, type SystemRow, type SystemsDraft } from "../lib/authoring/systems-draft";
import { emptySystemsSession, type SystemsSession } from "../lib/authoring/systems-session";
import { buildExportFrame } from "../lib/export";
import { discardGuidedCheckpoint, saveGuidedCheckpoint } from "../lib/persistence/guided-drafts";
import { listSystemsDrafts, makeSystemsCheckpoint, resumeSystemsDraft, type SystemsCheckpoint } from "../lib/persistence/systems-drafts";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { downloadText } from "../lib/storage";
import Modal from "./Modal";
import GuidedCheckpointTimes from "./GuidedCheckpointTimes";

const shapes = Object.keys(shapeDelimiters) as SystemRow["shape"][];
const roles = { neutral: "Neutral", service: "Service", database: "Database", queue: "Queue", external: "External system", person: "Person" };
const directions = { forward: "One-way", both: "Both ways", none: "No arrows" };
const batch = 20;
type Review = { document: MermaidProjectV3; rendered: RenderResult; url: string; proposal?: ReadyProposal };
type ExistingTarget = GuidedAttachmentTarget & {
  title: string;
  prepare: (values: SystemsDraft, attachment: GuidedAttachment | undefined, signal: AbortSignal) =>
    Promise<{ document: MermaidProjectV3; rendered: RenderResult; proposal: ReadyProposal }>;
  apply: (proposal: ReadyProposal, signal: AbortSignal) => Promise<"applied" | "stale">;
  onCompleted: (draftRetained: boolean) => void;
};
type SharedProps = {
  session: SystemsSession; onSession: Dispatch<SetStateAction<SystemsSession>>;
  onBack: () => void; onClose: () => void;
};
type Props = SharedProps & (
  | { target?: never; onCreated: (id: string, draftRetained: boolean) => void }
  | { target: ExistingTarget; onCreated?: never }
);

export default function GuidedSystemsDialog({ session, onSession, onBack, onClose, onCreated, target }: Props) {
  const { values, checkpoint, dirty } = session;
  const [stage, setStage] = useState<"systems" | "connections">("systems");
  const [saved, setSaved] = useState<SystemsCheckpoint[]>([]);
  const [review, setReview] = useState<Review>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [recoveryExport, setRecoveryExport] = useState<SystemsCheckpoint>();
  const [nodeStart, setNodeStart] = useState(0);
  const [edgeStart, setEdgeStart] = useState(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void withDatabase(listSystemsDrafts).then(result => { if (active) setSaved(result); }).catch(() => {
      if (active) setError("Saved system drafts could not be read.");
    });
    return () => { active = false; controller.current?.abort(); };
  }, []);
  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url); }, [review]);

  function change(update: Partial<SystemsDraft>) {
    setError("");
    setRecoveryExport(undefined);
    onSession(current => ({ ...current, values: { ...current.values, ...update }, dirty: true }));
  }
  function editNode(id: string, update: Partial<SystemRow>) {
    change({ nodes: values.nodes.map(item => item.id === id ? { ...item, ...update } : item) });
  }
  function editConnection(id: string, update: Partial<SystemConnection>) {
    change({ edges: values.edges.map(item => item.id === id ? { ...item, ...update } : item) });
  }

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (controller.current) return;
    const work = new AbortController();
    controller.current = work;
    setBusy(label);
    setError("");
    try { await action(work.signal); }
    catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "The systems diagram could not continue.");
    } finally {
      controller.current = null;
      if (!work.signal.aborted) setBusy("");
    }
  }

  function checkpointDraft() {
    void run("Saving draft", async () => {
      setRecoveryExport(undefined);
      const now = Date.now();
      const record = makeSystemsCheckpoint(values, checkpoint?.id ?? crypto.randomUUID(), now);
      try {
        await withDatabase(db => saveGuidedCheckpoint(db, record, checkpoint, now));
      } catch (reason) {
        setRecoveryExport(record);
        throw reason;
      }
      onSession(current => ({ ...current, checkpoint: record, dirty: false }));
      setSaved(current => [record, ...current.filter(item => item.id !== record.id)]);
    });
  }

  function reviewDiagram() {
    void run("Rendering the proposed diagram", async signal => {
      const input = normalizeSystemsDraft(values);
      const port = readyGuidedAttachment(target?.attachment);
      const result = target
        ? await target.prepare(input, port, signal)
        : await prepareGuidedFlowchart(input.title.trim() || "Untitled systems diagram", {
            direction: input.direction,
            nodes: input.nodes.map(item => ({ key: item.id, label: item.label, shape: item.shape, role: item.role })),
            edges: input.edges.map(item => ({ from: item.sourceId, to: item.targetId, label: item.label, direction: item.direction })),
          }, signal);
      const { svg } = buildExportFrame(result.rendered, result.document);
      signal.throwIfAborted();
      setPainted(false);
      setReview({ ...result, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    });
  }

  function create() {
    if (!review || !painted) return;
    void run("Saving project", async signal => {
      if (target) {
        if (!review.proposal || await target.apply(review.proposal, signal) !== "applied") {
          setReview(undefined);
          throw new Error("The saved project changed. Your systems and attachment are still in this draft. Preview again against the current project.");
        }
      }
      let retained = false;
      if (!target || checkpoint) {
        try {
          await withDatabase(async db => {
            if (!target) {
              signal.throwIfAborted();
              await writeWorkspaceProject(db, review.document, null);
            }
            if (checkpoint) {
              try { await discardGuidedCheckpoint(db, checkpoint); }
              catch { retained = true; }
            }
          });
        } catch (reason) {
          if (!target) throw reason;
          retained = true;
        }
      }
      if (target) target.onCompleted(retained);
      else onCreated(review.document.id, retained);
    });
  }

  function addNode() {
    setNodeStart(Math.floor(values.nodes.length / batch) * batch);
    change({ nodes: [...values.nodes, { id: `system-${crypto.randomUUID()}`, label: "", role: null, shape: "rect" }] });
  }

  const nodeLabels = new Map(values.nodes.map((item, index) => [item.id, `${item.label || "Unnamed system"} (${index + 1})`]));
  const validStage = values.nodes.length > 0 && values.nodes.every(item => item.label.trim());
  return <Modal title="Build a systems diagram" wide busy={busy.startsWith("Saving") || busy === "Discarding draft"} onClose={onClose}>
    <div className="heading-form">
      {target && <p>Insert systems into {target.title}.</p>}
      {!review && stage === "systems" && <>
        <button type="button" className="button quiet" disabled={!!busy} onClick={onBack}>{target ? "Back to project" : "Back to relationship tables"}</button>
        {!!saved.length && <ul className="project-list" aria-label="Saved systems drafts">
          {saved.map(record => <li className="project-row" key={record.id}>
            <button className="project-open" disabled={!!busy} onClick={() => {
              onSession({ values: resumeSystemsDraft(record), checkpoint: record, dirty: false });
              target?.onAttachment(emptyGuidedAttachment);
              setRecoveryExport(undefined);
              setNodeStart(0);
              setEdgeStart(0);
            }}><span><strong>Resume {record.payload.title || "Untitled systems diagram"}</strong>
              <small><GuidedCheckpointTimes checkpoint={record} /></small></span></button>
            <button className="button quiet" disabled={!!busy} onClick={() => void run("Discarding draft", async () => {
              await withDatabase(db => discardGuidedCheckpoint(db, record));
              setSaved(current => current.filter(item => item.id !== record.id));
              if (checkpoint?.id === record.id) onSession(emptySystemsSession);
            })}>Discard draft</button>
          </li>)}
        </ul>}
        {!target && <>
          <label>Project title<input maxLength={120} value={values.title} disabled={!!busy} onChange={event => change({ title: event.target.value })} /></label>
          <label>Layout direction<select value={values.direction} disabled={!!busy}
            onChange={event => change({ direction: event.target.value === "TB" ? "TB" : "LR" })}>
            <option value="LR">Left to right</option><option value="TB">Top to bottom</option>
          </select></label>
        </>}
        {values.nodes.slice(nodeStart, nodeStart + batch).map((item, index) => <fieldset key={item.id} className="guided-process-fieldset heading-form" disabled={!!busy}>
          <legend>System {nodeStart + index + 1}</legend>
          <label>Label<input value={item.label} maxLength={400} onChange={event => editNode(item.id, { label: event.target.value })} /></label>
          <label>Role<select value={item.role ?? ""} onChange={event => editNode(item.id, { role: systemRoles.find(role => role === event.target.value) ?? null })}>
            <option value="">No role</option>{systemRoles.map(role => <option key={role} value={role}>{roles[role]}</option>)}
          </select></label>
          <label>Shape<select value={item.shape} onChange={event => editNode(item.id, { shape: event.target.value as SystemRow["shape"] })}>
            {shapes.map(shape => <option key={shape} value={shape}>{shape === "rect" ? "Rectangle" : shape}</option>)}
          </select></label>
          <button className="button quiet" type="button" disabled={values.edges.some(edge => edge.sourceId === item.id || edge.targetId === item.id)}
            onClick={() => {
              const nodes = values.nodes.filter(node => node.id !== item.id);
              if (nodeStart >= nodes.length) setNodeStart(Math.max(0, nodeStart - batch));
              change({ nodes });
            }}>Remove system</button>
        </fieldset>)}
        <PageControls count={values.nodes.length} first={nodeStart} change={setNodeStart} label="systems" />
        <div className="dialog-actions">
          <button className="button secondary" disabled={!!busy || values.nodes.length >= 200} onClick={addNode}>Add system</button>
          <button className="button primary" disabled={!!busy || !validStage} onClick={() => setStage("connections")}>Review relationships</button>
        </div>
      </>}
      {!review && stage === "connections" && <>
        <p>{values.nodes.length} systems · {values.edges.length} explicit relationships</p>
        {values.edges.slice(edgeStart, edgeStart + batch).map((item, index) => <fieldset key={item.id} className="guided-process-fieldset heading-form" disabled={!!busy}>
          <legend>Relationship {edgeStart + index + 1}</legend>
          <label>From<select value={item.sourceId} onChange={event => editConnection(item.id, { sourceId: event.target.value })}>
            <option value="">Choose a system</option>{[...nodeLabels].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label>To<select value={item.targetId} onChange={event => editConnection(item.id, { targetId: event.target.value })}>
            <option value="">Choose a system</option>{[...nodeLabels].map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label>Relationship label<input maxLength={400} value={item.label} onChange={event => editConnection(item.id, { label: event.target.value })} /></label>
          <label>Direction<select value={item.direction} onChange={event => editConnection(item.id, { direction: event.target.value as SystemConnection["direction"] })}>
            {Object.entries(directions).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
          </select></label>
          <button className="button quiet" type="button" onClick={() => {
            const edges = values.edges.filter(edge => edge.id !== item.id);
            if (edgeStart >= edges.length) setEdgeStart(Math.max(0, edgeStart - batch));
            change({ edges });
          }}>Remove relationship</button>
        </fieldset>)}
        <PageControls count={values.edges.length} first={edgeStart} change={setEdgeStart} label="relationships" />
        {target && <GuidedAttachmentPicker target={target} disabled={!!busy}
          draftNodes={[...nodeLabels].map(([id, label]) => ({ id, label }))} />}
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => setStage("systems")}>Back to systems</button>
          <button className="button secondary" disabled={!!busy || values.edges.length >= 400} onClick={() => {
            setEdgeStart(Math.floor(values.edges.length / batch) * batch);
            change({ edges: [...values.edges, { id: `link-${crypto.randomUUID()}`, sourceId: "", targetId: "", label: "", direction: "forward" }] });
          }}>Add relationship</button>
          <button className="button secondary" disabled={!!busy} onClick={checkpointDraft}>Save systems draft</button>
          <button className="button primary" disabled={!!busy} onClick={reviewDiagram}>Preview systems diagram</button>
        </div>
      </>}
      {review && <section className="migration-preview" aria-label="Proposed systems diagram">
        <p>{target ? `Insert into ${review.document.title}` : "Create a separate project"} with {values.nodes.length} systems and {values.edges.length} relationships.</p>
        {target && <GuidedAttachmentSummary target={target} draftNodes={[...nodeLabels].map(([id, label]) => ({ id, label }))} />}
        <img src={review.url} alt="Proposed systems diagram" onLoad={() => setPainted(true)} onError={() => setError("The proposed diagram could not be displayed.")} />
        {!!values.edges.length && <details><summary>Review relationships</summary>
          <ul>{values.edges.map(item => <li key={item.id}>
            {nodeLabels.get(item.sourceId)} {item.direction === "both" ? "↔" : item.direction === "forward" ? "→" : "—"} {nodeLabels.get(item.targetId)}
            {item.label && ` · ${item.label}`}
          </li>)}</ul>
        </details>}
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => setReview(undefined)}>Back to relationships</button>
          <button className="button primary" disabled={!!busy || !painted} onClick={create}>{target ? "Insert reviewed systems" : "Create systems project"}</button>
        </div>
      </section>}
      <p role="status" className="guided-checkpoint-status">{busy ? `${busy}…` : dirty ? "Session-only changes"
        : checkpoint && <GuidedCheckpointTimes checkpoint={checkpoint} status />}</p>
      {error && <p role="alert">{error}</p>}
      {recoveryExport && dirty && <button type="button" className="button quiet" disabled={!!busy}
        onClick={() => downloadText(JSON.stringify(recoveryExport, null, 2), "systems.meridian-draft.json")}>
        Download normalized draft
      </button>}
    </div>
  </Modal>;
}

function PageControls({ count, first, change, label }: { count: number; first: number; change: (value: number) => void; label: string }) {
  if (count <= batch) return null;
  return <div className="recovery-actions">
    <button className="button quiet" disabled={first === 0} onClick={() => change(first - batch)}>Previous {label}</button>
    <span>{first + 1}–{Math.min(first + batch, count)} of {count}</span>
    <button className="button quiet" disabled={first + batch >= count} onClick={() => change(first + batch)}>Next {label}</button>
  </div>;
}

async function withDatabase<Result>(work: (db: IDBDatabase) => Promise<Result>) {
  const db = await openWorkspaceDatabase();
  try { return await work(db); }
  finally { db.close(); }
}
