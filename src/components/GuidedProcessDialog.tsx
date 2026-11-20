import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Modal from "./Modal";
import { prepareGuidedProcess, type ProcessStep } from "../lib/authoring/guided-process";
import { normalizeProcessInWorker, ProcessNormalizationTimeout } from "../lib/authoring/process-normalization";
import { buildExportFrame } from "../lib/export";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { discardProcessCheckpoint, listProcessCheckpoints, saveProcessCheckpoint, type ProcessCheckpoint } from "../lib/persistence/process-drafts";

export type GuidedProcessDraft = { title: string; text: string; checkpoint?: ProcessCheckpoint };
type Review = { document: Awaited<ReturnType<typeof prepareGuidedProcess>>["document"]; url: string };

export default function GuidedProcessDialog({ draft, onDraft, onCreated, onClose }: {
  draft: GuidedProcessDraft;
  onDraft: Dispatch<SetStateAction<GuidedProcessDraft>>;
  onCreated: (id: string, draftRetained?: boolean) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"input" | "connections" | "review">("input");
  const [steps, setSteps] = useState<ProcessStep[]>([]);
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
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url); }, [review]);
  useEffect(() => {
    if (stage === "input") titleInput.current?.focus();
    else stepHeading.current?.focus();
  }, [stage]);

  useEffect(() => {
    let closed = false;
    void withDatabase(listProcessCheckpoints).then(list => {
      if (!closed) setDrafts(list);
    }).catch(() => {
      if (!closed) setDraftError("Local drafts could not be opened.");
    });
    return () => { closed = true; };
  }, []);

  async function checkpoint(normalized: ProcessStep[]) {
    setBusy("checkpoint");
    setDraftError("");
    try {
      const saved = await withDatabase(db => saveProcessCheckpoint(db, draft.title, normalized, draft.checkpoint));
      onDraft(current => ({ ...current, checkpoint: saved }));
      setDrafts(current => [saved, ...current.filter(item => item.id !== saved.id)]);
    } catch (reason) {
      setDraftError(reason instanceof Error ? reason.message : "The draft could not be saved.");
    } finally {
      setBusy(undefined);
    }
  }

  async function showConnections(extended = false) {
    if (controller.current) return;
    const attempt = new AbortController();
    controller.current = attempt;
    setBusy("normalize");
    setError("");
    try {
      const normalized = await normalizeProcessInWorker(draft.text, attempt.signal, extended);
      attempt.signal.throwIfAborted();
      setSteps(normalized);
      setStage("connections");
      setNormalization(null);
      void checkpoint(normalized);
    } catch (reason) {
      if (!attempt.signal.aborted) {
        if (reason instanceof ProcessNormalizationTimeout) setNormalization(extended ? "narrow" : "retry");
        setError(extended && reason instanceof ProcessNormalizationTimeout ? "Shorten your process list before trying again."
          : reason instanceof Error ? reason.message : "Check your process steps.");
        setBusy(undefined);
      }
    } finally {
      controller.current = undefined;
    }
  }

  function resume(saved: ProcessCheckpoint) {
    const normalized = saved.payload.nodes.map(node => ({ line: node.sourceRow, original: node.label, label: node.label }));
    onDraft({ title: saved.payload.title, text: normalized.map(row => row.label).join("\n"), checkpoint: saved });
    setSteps(normalized);
    setDraftError("");
    setError("");
    setStage("connections");
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
      const { document, rendered } = await prepareGuidedProcess(draft.title, steps, attempt.signal);
      attempt.signal.throwIfAborted();
      const svg = buildExportFrame(rendered, document).svg;
      setImageReady(false);
      setReview({ document, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
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
      db = await openWorkspaceDatabase();
      await writeWorkspaceProject(db, review.document, null);
      const draftRetained = draft.checkpoint
        ? await discardProcessCheckpoint(db, draft.checkpoint).then(() => false, () => true)
        : false;
      onCreated(review.document.id, draftRetained);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The project could not be saved.");
    } finally {
      db?.close();
      writing.current = false;
      setBusy(undefined);
    }
  }

  return (
    <Modal title="Build with guidance" wide onClose={onClose}
      busy={busy === "save" || busy === "checkpoint" || busy === "discard"} initialFocus="[name='process-title']">
      <h3 tabIndex={-1} ref={stepHeading}>{stage === "input" ? "Process steps" : stage === "connections" ? "Connections" : "Review your process"}</h3>
      {stage === "input" && (
        <form className="heading-form" onSubmit={event => { event.preventDefault(); if (!busy && normalization === null) void showConnections(); }}>
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
          <label>Project title<input name="process-title" ref={titleInput} maxLength={120} value={draft.title} readOnly={busy === "normalize"}
            onChange={event => onDraft({ ...draft, title: event.target.value })} /></label>
          <label>Put one step on each line
            <textarea value={draft.text} rows={7} readOnly={busy === "normalize"} placeholder={"Receive request\nReview request\nSend decision"}
              onChange={event => {
                setNormalization(null);
                setError("");
                onDraft({ ...draft, text: event.target.value });
              }} />
          </label>
          <p className="muted-note">Leading bullets and numbered prefixes are removed when followed by a space. Unreviewed input stays in this session.</p>
          <div className="dialog-actions">
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
          <p>{steps.length} steps · {steps.length - 1} connections · New project</p>
          <ol className="guided-process-connections">
            {steps.map((step, index) => (
              <li key={step.line}>
                <strong>{step.label}</strong>
                {step.label !== step.original && <small>From line {step.line}: {step.original}</small>}
                {steps[index + 1] && <span>Next: {steps[index + 1].label}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
      {stage === "connections" && (
        <div className="dialog-actions">
          <button className="button quiet" disabled={!!busy} onClick={() => { setError(""); setStage("input"); }}>Back to steps</button>
          <button className="button primary" disabled={!!busy} onClick={() => void showReview()}>Preview process</button>
        </div>
      )}
      {stage === "review" && review && (
        <>
          <div className="migration-preview">
            <img src={review.url} alt="Proposed process diagram" onLoad={() => setImageReady(true)}
              onError={() => setError("The preview image could not be displayed.")} />
            <details><summary>Mermaid source</summary><pre>{review.document.source}</pre></details>
          </div>
          <div className="dialog-actions">
            <button className="button quiet" disabled={!!busy} onClick={() => { setReview(undefined); setError(""); setStage("connections"); }}>Back to connections</button>
            <button className="button primary" disabled={!!busy || !imageReady} onClick={() => void create()}>Create process</button>
          </div>
        </>
      )}
      {busy === "normalize" && <p role="status">Reading process steps…</p>}
      {busy === "preview" && <p role="status">Checking and rendering the process…</p>}
      {busy === "save" && <p role="status">Saving the new project…</p>}
      {busy === "checkpoint" && <p role="status">Saving draft…</p>}
      {stage !== "input" && !busy && !draftError && draft.checkpoint && (
        <p role="status">Draft saved locally · expires {formatTime(draft.checkpoint.expiresAt)}</p>
      )}
      {draftError && <p role="alert">{stage === "input" ? draftError : `Session-only draft. ${draftError}`}</p>}
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
