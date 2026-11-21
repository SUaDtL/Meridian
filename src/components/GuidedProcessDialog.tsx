import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Modal from "./Modal";
import GuidedAttachmentPicker, { emptyGuidedAttachment, GuidedAttachmentSummary, readyGuidedAttachment, type GuidedAttachmentTarget } from "./GuidedAttachmentPicker";
import type { GuidedAttachment } from "../lib/authoring/guided-systems-insertion";
import type { ReadyProposal } from "../lib/authoring/proposals";
import ProcessConnectionTable from "./ProcessConnectionTable";
import { prepareGuidedProcess, type ProcessStep } from "../lib/authoring/guided-process";
import { markProcessDecision, type ProcessConnections } from "../lib/authoring/process-connections";
import { AuthoringWorkerTimeout } from "../lib/authoring/authoring-worker";
import { normalizeProcessInWorker } from "../lib/authoring/process-normalization";
import { buildExportFrame } from "../lib/export";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { checkpointConnections, discardProcessCheckpoint, listProcessCheckpoints, makeProcessCheckpoint, saveProcessCheckpoint, type ProcessCheckpoint } from "../lib/persistence/process-drafts";

import { downloadText } from "../lib/storage";

export type GuidedProcessDraft = {
  title: string;
  text: string;
  steps?: ProcessStep[];
  connections?: ProcessConnections;
  unsaved?: boolean;
  checkpoint?: ProcessCheckpoint;
};
type PreparedProcess = Pick<Awaited<ReturnType<typeof prepareGuidedProcess>>, "document" | "rendered">;
type Review = Pick<PreparedProcess, "document"> & { url: string; proposal?: ReadyProposal };
type ExistingTarget = GuidedAttachmentTarget & {
  title: string;
  prepare: (steps: readonly ProcessStep[], connections: ProcessConnections | undefined,
    attachment: GuidedAttachment | undefined, signal: AbortSignal) => Promise<PreparedProcess & { proposal: ReadyProposal }>;
  apply: (proposal: ReadyProposal) => Promise<"applied" | "stale">;
  onCompleted: (draftRetained: boolean) => void;
};

type Props = {
  draft: GuidedProcessDraft;
  onDraft: Dispatch<SetStateAction<GuidedProcessDraft>>;
  onClose: () => void;
} & (
  | { target?: never; onCreated: (id: string, draftRetained?: boolean) => void;
      onRelationshipTable: () => void; onComponents: () => void; onChart: () => void; onEngineeringFile: () => void }
  | { target: ExistingTarget; onCreated?: never; onRelationshipTable?: never; onComponents?: never;
      onChart?: never; onEngineeringFile?: never }
);

export default function GuidedProcessDialog({ draft, onDraft, onCreated, onRelationshipTable, onComponents, onChart, onEngineeringFile, onClose, target }: Props) {
  const [stage, setStage] = useState<"input" | "connections" | "review">("input");
  const [review, setReview] = useState<Review>();
  const [imageReady, setImageReady] = useState(false);
  const [busy, setBusy] = useState<"normalize" | "preview" | "save" | "checkpoint" | "discard">();
  const [normalization, setNormalization] = useState<"retry" | "narrow" | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<ProcessCheckpoint[]>([]);
  const [draftError, setDraftError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const writing = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const stepsInput = useRef<HTMLTextAreaElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const steps = draft.steps ?? [];
  const connections = draft.connections;
  const draftNodes = steps.map(step => ({ id: String(step.line), label: `${step.label} · line ${step.line}` }));
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url); }, [review]);
  useEffect(() => {
    if (stage === "input") (target ? stepsInput.current : titleInput.current)?.focus();
    else stepHeading.current?.focus();
  }, [stage, !!target]);

  useEffect(() => {
    let closed = false;
    void withDatabase(listProcessCheckpoints).then(list => {
      if (!closed) setDrafts(list);
    }).catch(() => {
      if (!closed) setDraftError("Local drafts could not be opened.");
    });
    return () => { closed = true; };
  }, []);

  async function checkpoint(normalized: ProcessStep[], explicit = connections) {
    setBusy("checkpoint");
    setDraftError("");
    try {
      const saved = await withDatabase(db => saveProcessCheckpoint(db, draft.title, normalized, draft.checkpoint, explicit));
      onDraft(current => ({ ...current, checkpoint: saved, unsaved: false }));
      setDrafts(current => [saved, ...current.filter(item => item.id !== saved.id)]);
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : "The draft could not be saved.");
    } finally {
      setBusy(undefined);
    }
  }

  async function showConnections(extended = false) {
    if (controller.current) return;
    if (draft.steps) {
      setError("");
      setStage("connections");
      return;
    }
    const attempt = new AbortController();
    controller.current = attempt;
    setBusy("normalize");
    setError("");
    try {
      const normalized = await normalizeProcessInWorker(draft.text, attempt.signal, extended);
      attempt.signal.throwIfAborted();
      onDraft(current => ({ ...current, steps: normalized, unsaved: true }));
      setStage("connections");
      setNormalization(null);
      void checkpoint(normalized);
    } catch (reason) {
      if (!attempt.signal.aborted) {
        if (reason instanceof AuthoringWorkerTimeout) setNormalization(extended ? "narrow" : "retry");
        setError(extended && reason instanceof AuthoringWorkerTimeout ? "Shorten your process list before trying again."
          : reason instanceof Error ? reason.message : "Check your process steps.");
        setBusy(undefined);
      }
    } finally {
      controller.current = undefined;
    }
  }

  function downloadDraft() {
    try {
      const record = makeProcessCheckpoint(draft.title, steps, crypto.randomUUID(), Date.now(), connections);
      downloadText(JSON.stringify(record, null, 2), "process.meridian-draft.json");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The normalized draft could not be downloaded.");
    }
  }

  function resume(saved: ProcessCheckpoint) {
    target?.onAttachment(emptyGuidedAttachment);
    const normalized = saved.payload.nodes.map(node => ({ line: node.sourceRow, original: node.label, label: node.label }));
    onDraft({ title: saved.payload.title, text: normalized.map(row => row.label).join("\n"),
      steps: normalized, connections: checkpointConnections(saved), checkpoint: saved });
    setDraftError("");
    setError("");
    setStage("connections");
  }

  function editConnections(explicit: ProcessConnections) {
    setError("");
    onDraft(current => ({ ...current, connections: explicit, unsaved: true }));
  }

  function moveStep(index: number, offset: -1 | 1) {
    const reordered = [...steps];
    const destination = index + offset;
    [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
    onDraft(current => ({ ...current, steps: reordered, unsaved: true }));
  }

  async function discard(saved: ProcessCheckpoint) {
    setBusy("discard");
    setDraftError("");
    try {
      await withDatabase(db => discardProcessCheckpoint(db, saved));
      setDrafts(current => current.filter(item => item.id !== saved.id));
      onDraft(current => current.checkpoint?.id === saved.id ? { title: "", text: "" } : current);
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : "The draft could not be cleared.");
    } finally {
      setBusy(undefined);
    }
  }

  async function showReview() {
    if (controller.current) return;
    const attempt = new AbortController();
    controller.current = attempt;
    setBusy("preview");
    setError("");
    try {
      const prepared: PreparedProcess & { proposal?: ReadyProposal } = target
        ? await target.prepare(steps, connections, readyGuidedAttachment(target.attachment), attempt.signal)
        : await prepareGuidedProcess(draft.title, steps, attempt.signal, connections);
      const { document, rendered, proposal } = prepared;
      attempt.signal.throwIfAborted();
      const svg = buildExportFrame(rendered, document).svg;
      setImageReady(false);
      setReview({ document, proposal, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
      setStage("review");
    } catch (reason) {
      if (!attempt.signal.aborted) setError(reason instanceof Error ? reason.message : "The diagram could not be previewed.");
    } finally {
      if (!attempt.signal.aborted) setBusy(undefined);
      controller.current = undefined;
    }
  }

  async function create() {
    if (!review || !imageReady || writing.current) return;
    writing.current = true;
    setBusy("save");
    setError("");
    let db: IDBDatabase | undefined;
    try {
      if (target) {
        if (!review.proposal) throw new Error("Preview the current insertion first.");
        if (await target.apply(review.proposal) === "stale") {
          setReview(undefined);
          setStage("connections");
          throw new Error("The saved project changed. Your steps, connections and attachment are still in this draft. Preview against the current project.");
        }
        const checkpoint = draft.checkpoint;
        const draftRetained = !!checkpoint &&
          await withDatabase(local => discardProcessCheckpoint(local, checkpoint)).then(() => false, () => true);
        target.onCompleted(draftRetained);
        return;
      }
      db = await openWorkspaceDatabase();
      await writeWorkspaceProject(db, review.document, null);
      const draftRetained = draft.checkpoint
        ? await discardProcessCheckpoint(db, draft.checkpoint).then(() => false, () => true)
        : false;
      onCreated?.(review.document.id, draftRetained);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The project could not be saved.");
    } finally {
      db?.close();
      writing.current = false;
      setBusy(undefined);
    }
  }

  return (
    <Modal title={target ? "Insert process diagram" : "Build with guidance"} wide onClose={onClose}
      busy={busy === "save" || busy === "checkpoint" || busy === "discard"} initialFocus={target ? "[name='process-steps']" : "[name='process-title']"}>
      <h3 tabIndex={-1} ref={stepHeading}>{stage === "input" ? "Process steps" : stage === "connections" ? "Connections" : "Review your process"}</h3>
      {stage === "input" && (
        <form className="heading-form" onSubmit={event => { event.preventDefault(); if (!busy && normalization === null) void showConnections(); }}>
          {!target && <>
            <button type="button" className="button quiet" disabled={!!busy} onClick={onRelationshipTable}>Systems and relationships</button>
            <button type="button" className="button quiet" disabled={!!busy} onClick={onComponents}>Browse components</button>
            <button type="button" className="button quiet" disabled={!!busy} onClick={onChart}>Chart values</button>
            <button type="button" className="button quiet" disabled={!!busy} onClick={onEngineeringFile}>Engineering file</button>
          </>}
          {drafts.length > 0 && (
            <ul className="project-list">
              {drafts.map(saved => (
                <li className="project-row" key={saved.id}>
                  <button type="button" className="project-open" disabled={!!busy} onClick={() => resume(saved)}>
                    <span>
                      <strong>Resume {saved.payload.title || "Untitled process"}</strong>
                      <small>Saved {formatTime(saved.createdAt)} · expires {formatTime(saved.expiresAt)}</small>
                    </span>
                  </button>
                  <button type="button" className="button quiet" disabled={!!busy} aria-label={`Discard draft ${saved.payload.title || "Untitled process"}`}
                    onClick={() => void discard(saved)}>Discard draft</button>
                </li>
              ))}
            </ul>
          )}
          {target ? <p>Destination <strong>{target.title}</strong></p> : <label>Project title<input name="process-title" ref={titleInput} maxLength={120} value={draft.title} readOnly={busy === "normalize"}
            onChange={event => onDraft({ ...draft, title: event.target.value, unsaved: true })} /></label>}
          <label>Put one step on each line
            <textarea name="process-steps" ref={stepsInput} value={draft.text} rows={7} readOnly={busy === "normalize" || !!connections} placeholder={"Receive request\nReview request\nSend decision"}
              onChange={event => {
                setNormalization(null);
                setError("");
                target?.onAttachment(emptyGuidedAttachment);
                onDraft({ title: draft.title, text: event.target.value, checkpoint: draft.checkpoint, unsaved: true });
              }} />
          </label>
          <p className="muted-note">Leading bullets and numbered prefixes are removed when followed by a space. Unreviewed input stays in this session.</p>
          {connections && <p className="muted-note">These steps are tied to your explicit connections. Starting a new list keeps the last saved draft.</p>}
          <div className="dialog-actions">
            {connections && <button type="button" className="button quiet" onClick={() => {
              setError("");
              setDraftError("");
              target?.onAttachment(emptyGuidedAttachment);
              onDraft({ title: draft.title, text: draft.text, unsaved: true });
            }}>{draft.unsaved ? "Discard unsaved changes and start a new list" : "Start a new step list"}</button>}
            {normalization === "retry" ? (
              <button type="button" className="button primary" disabled={!!busy} onClick={() => void showConnections(true)}>Retry for five seconds</button>
            ) : (
              <button type="submit" className="button primary" disabled={!!busy || normalization === "narrow"}>Review connections</button>
            )}
          </div>
        </form>
      )}
      {stage !== "input" && (
        <>
          <p>{steps.length} steps · {connections?.edges.length ?? steps.length - 1} connections · {target ? target.title : "New project"}</p>
          <ol aria-label="Process steps" className="guided-process-connections">
            {steps.map((step, index) => (
              <li key={step.line}>
                <strong>{step.label}</strong>
                {step.label !== step.original && <small>From line {step.line}: {step.original}</small>}
                {!connections && steps[index + 1] && <span>Next: {steps[index + 1].label}</span>}
                {connections?.decisions.includes(step.line) && <span>Decision</span>}
                {stage === "connections" && steps.length >= 3 && !connections?.decisions.includes(step.line) && (
                  <button type="button" className="button quiet" disabled={!!busy}
                    onClick={() => editConnections(markProcessDecision(steps, connections, step.line))}>Make {step.label} a decision</button>
                )}
                {stage === "connections" && connections && !connections.decisions.includes(step.line) && (
                  <label className="check-label"><input type="checkbox" checked={connections.terminal.includes(step.line)} disabled={!!busy}
                    onChange={event => editConnections({ ...connections, terminal: event.target.checked
                      ? [...connections.terminal, step.line] : connections.terminal.filter(line => line !== step.line) })} /> Mark {step.label} as an end</label>
                )}
                {stage === "connections" && connections && (
                  <div className="process-step-actions">
                    <button type="button" className="button quiet" disabled={!!busy || index === 0}
                      onClick={() => moveStep(index, -1)}>Move {step.label} up</button>
                    <button type="button" className="button quiet" disabled={!!busy || index === steps.length - 1}
                      onClick={() => moveStep(index, 1)}>Move {step.label} down</button>
                  </div>
                )}
                {stage === "review" && connections?.terminal.includes(step.line) && <span>End</span>}
              </li>
            ))}
          </ol>
          {connections && stage === "connections" && (
            <ProcessConnectionTable steps={steps} connections={connections} disabled={!!busy} onChange={editConnections} />
          )}
          {connections && stage === "review" && (
            <ol aria-label="Reviewed connections" className="guided-process-connections">
              {connections.edges.map(edge => <li key={edge.id}>
                {steps.find(step => step.line === edge.from)?.label} → {steps.find(step => step.line === edge.to)?.label}
                {edge.label && <> ({edge.label})</>}
              </li>)}
            </ol>
          )}
        </>
      )}
      {stage === "connections" && target && <GuidedAttachmentPicker target={target} disabled={!!busy}
        draftNodes={draftNodes} />}
      {stage === "connections" && (
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => { setError(""); setStage("input"); }}>Back to steps</button>
          {draft.unsaved && <button className="button" disabled={!!busy} onClick={() => void checkpoint(steps)}>Save draft</button>}
          <button className="button primary" disabled={!!busy} onClick={() => void showReview()}>Preview process</button>
        </div>
      )}
      {stage === "review" && review && (
        <>
          {target && <p>Destination <strong>{target.title}</strong></p>}
          {target && <GuidedAttachmentSummary target={target} draftNodes={draftNodes} />}
          <div className="migration-preview">
            <img src={review.url} alt="Proposed process diagram" onLoad={() => setImageReady(true)}
              onError={() => setError("The preview image could not be displayed.")} />
            <details><summary>Mermaid source</summary><pre>{review.document.source}</pre></details>
          </div>
          <div className="dialog-actions">
            <button className="button quiet" disabled={!!busy} onClick={() => { setReview(undefined); setError(""); setStage("connections"); }}>Back to connections</button>
            <button className="button primary" disabled={!!busy || !imageReady} onClick={() => void create()}>{target ? "Insert process" : "Create process"}</button>
          </div>
        </>
      )}
      {busy === "normalize" && <p role="status">Reading process steps…</p>}
      {busy === "preview" && <p role="status">Checking and rendering the process…</p>}
      {busy === "save" && <p role="status">{target ? "Saving the insertion…" : "Saving the new project…"}</p>}
      {busy === "checkpoint" && <p role="status">Saving draft…</p>}
      {stage !== "input" && !busy && !draftError && draft.checkpoint && !draft.unsaved && (
        <p role="status">Draft saved locally · expires {formatTime(draft.checkpoint.expiresAt)}</p>
      )}
      {stage !== "input" && !busy && !draftError && draft.unsaved && <p role="status">Session-only draft changes</p>}
      {draftError && <p role="alert">{stage === "input" ? draftError : `Session-only draft. ${draftError}`}</p>}
      {draftError && stage !== "input" && draft.unsaved && steps.length > 0 && <button type="button"
        className="button quiet" disabled={!!busy} onClick={downloadDraft}>Download normalized draft</button>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function withDatabase<Result>(work: (db: IDBDatabase) => Promise<Result>): Promise<Result> {
  const db = await openWorkspaceDatabase();
  try {
    return await work(db);
  } finally {
    db.close();
  }
}
