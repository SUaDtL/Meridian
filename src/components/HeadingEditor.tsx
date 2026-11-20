import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { ProposalOutcome } from "../lib/workspace";
import {
  staleHeadingMessage, workspaceBaseToken, type HeadingDocument, type ProposalBase, type ReadyProposal,
} from "../lib/authoring/proposals";
import Modal from "./Modal";

export default function HeadingEditor<Project extends HeadingDocument>({
  document,
  field,
  revision,
  outcome,
  prepare,
  onApply,
  onClose,
}: {
  document: Project;
  field: "title" | "subtitle";
  revision: number;
  outcome?: ProposalOutcome;
  prepare: (base: ProposalBase<Project>, envelope: unknown) => Promise<ReadyProposal>;
  onApply: (proposal: ReadyProposal) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [subtitle, setSubtitle] = useState(document.subtitle);
  const [show, setShow] = useState(document.settings.showTitle);
  const [base, setBase] = useState(() => ({ document, revision }));
  const [requestId, setRequestId] = useState<string>();
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const settled = requestId && outcome?.id === requestId ? outcome.status : undefined;
  const busy = Boolean(requestId && !settled);
  const accepted = settled === "applied" || settled === "unchanged";
  const stale = settled === "stale" || (!busy && !accepted
    && (document !== base.document || revision !== base.revision));
  useEffect(() => {
    if (accepted) onClose();
  }, [accepted, onClose]);

  async function applyHeading() {
    if (inFlight.current || busy || stale) return;
    inFlight.current = true;
    setError("");
    try {
      const id = crypto.randomUUID();
      setRequestId(id);
      const proposal = await prepare(base, {
        schema: "meridian-proposal/v1",
        id,
        documentKind: "mermaid",
        baseToken: await workspaceBaseToken(base),
        origin: "canvas",
        operations: [{ op: "setHeading", title: title.trim() || "Untitled diagram", subtitle, showTitle: show }],
      });
      if (mounted.current) onApply(proposal);
    } catch (reason) {
      if (mounted.current) {
        setRequestId(undefined);
        setError(reason instanceof Error ? reason.message : "The heading could not be saved.");
      }
    } finally {
      inFlight.current = false;
    }
  }

  const message = stale ? staleHeadingMessage
    : settled === "history-limit" ? "There is not enough space to keep Undo for this change."
    : settled === "invalid" ? "The heading could not be applied. Try again."
    : error;

  return (
    <Modal
      title="Edit heading"
      eyebrow="ON YOUR CANVAS"
      onClose={onClose}
      busy={busy}
      initialFocus={`[name="${field}"]`}
    >
      <form
        className="heading-form"
        onSubmit={(event) => {
          event.preventDefault();
          void applyHeading();
        }}
      >
        <label>
          Title
          <input
            name="title"
            aria-label="Title"
            value={title}
            maxLength={120}
            readOnly={busy}
            onChange={(event) => setTitle(event.target.value)}
            onFocus={(event) => event.target.select()}
            placeholder="Untitled diagram"
          />
          <small>{title.length} / 120</small>
        </label>
        <label>
          Subtitle
          <input
            name="subtitle"
            aria-label="Subtitle"
            value={subtitle}
            maxLength={240}
            readOnly={busy}
            onChange={(event) => setSubtitle(event.target.value)}
            placeholder="Optional context for your audience"
          />
          <small>{subtitle.length} / 240</small>
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={show}
            disabled={busy}
            onChange={(event) => setShow(event.target.checked)}
          />
          <span>
            Show heading on canvas
            <small>Your title also names this project and its exports.</small>
          </span>
        </label>
        {message && <p role="alert">{message}</p>}
        {stale && (
          <div>
            <p>Current title: {document.title}</p>
            <p>Current subtitle: {document.subtitle || "None"}</p>
            <p>Current canvas heading: {document.settings.showTitle ? "Shown" : "Hidden"}</p>
            <button type="button" className="button quiet" onClick={() => {
              setBase({ document, revision });
              setRequestId(undefined);
              setError("");
            }}>Keep editing my draft</button>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={busy || stale}>
            <Check size={16} />
            Apply heading
          </button>
        </div>
      </form>
    </Modal>
  );
}
