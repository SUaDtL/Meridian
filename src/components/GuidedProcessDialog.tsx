import { useEffect, useRef, useState } from "react";
import Modal from "./Modal";
import { normalizeProcessSteps, prepareGuidedProcess, type ProcessStep } from "../lib/authoring/guided-process";
import { buildExportFrame } from "../lib/export";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";

export type GuidedProcessDraft = { title: string; text: string };
type Review = { document: Awaited<ReturnType<typeof prepareGuidedProcess>>["document"]; url: string };

export default function GuidedProcessDialog({ draft, onDraft, onCreated, onClose }: {
  draft: GuidedProcessDraft;
  onDraft: (draft: GuidedProcessDraft) => void;
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"input" | "connections" | "review">("input");
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [review, setReview] = useState<Review>();
  const [imageReady, setImageReady] = useState(false);
  const [busy, setBusy] = useState<"preview" | "save">();
  const [error, setError] = useState("");
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

  function showConnections() {
    setError("");
    try {
      setSteps(normalizeProcessSteps(draft.text));
      setStage("connections");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Check your process steps.");
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
      onCreated(review.document.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The project could not be saved.");
    } finally {
      db?.close();
      writing.current = false;
      setBusy(undefined);
    }
  }

  return (
    <Modal title="Build with guidance" wide onClose={onClose} busy={busy === "save"} initialFocus="[name='process-title']">
      <h3 tabIndex={-1} ref={stepHeading}>{stage === "input" ? "Process steps" : stage === "connections" ? "Connections" : "Review your process"}</h3>
      {stage === "input" && (
        <form className="heading-form" onSubmit={event => { event.preventDefault(); showConnections(); }}>
          <label>Project title<input name="process-title" ref={titleInput} maxLength={120} value={draft.title}
            onChange={event => onDraft({ ...draft, title: event.target.value })} /></label>
          <label>Put one step on each line
            <textarea value={draft.text} rows={7} placeholder={"Receive request\nReview request\nSend decision"}
              onChange={event => onDraft({ ...draft, text: event.target.value })} />
          </label>
          <p className="muted-note">Leading bullets and numbered prefixes are removed when followed by a space. Input stays in this session until you create the project.</p>
          <div className="dialog-actions"><button type="submit" className="button primary">Review connections</button></div>
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
      {busy === "preview" && <p role="status">Checking and rendering the process…</p>}
      {busy === "save" && <p role="status">Saving the new project…</p>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
