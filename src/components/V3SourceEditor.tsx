import { useEffect, useRef, useState } from "react";
import { authoringLimits } from "../lib/authoring/flowchart-source";
import { sourceLineEndings } from "../lib/authoring/manual-source";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import { renderMermaidProject } from "../lib/authoring/project-render";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildExportFrame } from "../lib/export";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Prepared = Awaited<ReturnType<Editor["prepareSource"]>>;
export type SourceDraft = { base: string; text: string; normalize: boolean };

export default function V3SourceEditor({ editor, savedDraft, onDraft, onApply, onClose }: {
  editor: Editor;
  savedDraft?: SourceDraft;
  onDraft: (draft: SourceDraft) => void;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStructure"]>["status"];
  onClose: () => void;
}) {
  const [base] = useState(editor.snapshot);
  const baseText = base.source.replace(/\r\n?/g, "\n");
  const [draft, setDraft] = useState<SourceDraft>(() => savedDraft?.base === base.source ? savedDraft
    : { base: base.source, text: baseText, normalize: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<(Prepared & { url: string })>();
  const [painted, setPainted] = useState(false);
  const request = useRef<AbortController | null>(null);
  const lineEndings = sourceLineEndings(base.source);
  const source = lineEndings === "crlf" ? draft.text.replace(/\n/g, "\r\n") : draft.text;
  const canPreview = source !== base.source && (lineEndings !== "mixed" || draft.normalize);
  const hasDraft = draft.text !== baseText || draft.normalize;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  function change(next: SourceDraft) {
    setDraft(next);
    onDraft(next);
    setPreview(undefined);
    setPainted(false);
    setError("");
  }

  async function prepare() {
    if (!canPreview || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setPreview(undefined);
    setPainted(false);
    setError("");
    try {
      const checked = await editor.prepareSource(source, base, controller.signal);
      const candidate = editor.readStructurePreview(checked.proposal);
      if (!candidate) throw new Error("The project changed. Reopen the editor to review the current revision.");
      const rendered = await renderMermaidProject(candidate, controller.signal);
      controller.signal.throwIfAborted();
      if (!rendered.targetTable) throw new Error("The preview could not resolve the project’s diagram targets.");
      const svg = buildExportFrame(rendered.result, candidate).svg;
      setPreview({ ...checked, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The revised source could not be previewed.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!preview || !painted) return;
    const status = onApply(preview.proposal);
    if (status === "applied") onClose();
    else {
      setPreview(undefined);
      setError(status === "stale" ? "The project changed. Reopen the editor to review the current revision."
        : "The source could not be applied with Undo.");
    }
  }

  return <Modal title="Edit Mermaid source" wide onClose={onClose} initialFocus="[name='v3-source-draft']">
    <form className="heading-form" onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <p>Preview and apply source changes that keep the current diagram’s bindings. The draft stays in this session until you apply or discard it.</p>
      <label>Mermaid source
        <textarea name="v3-source-draft" spellCheck={false} autoCapitalize="off" rows={13} value={draft.text} disabled={busy}
          maxLength={authoringLimits.sourceCodeUnits} onChange={event => change({ ...draft, text: event.target.value })} />
      </label>
      {lineEndings === "mixed" && <label className="check-label">
        <input type="checkbox" disabled={busy} checked={draft.normalize}
          onChange={event => change({ ...draft, normalize: event.target.checked })} />
        Use LF line endings for this edit
      </label>}
      {busy && <p role="status">Checking and rendering the revised source…</p>}
      {error && <p role="alert">{error}</p>}
      {preview && <section aria-label="Proposed source edit" className="migration-preview">
        <p>{preview.preserved} existing bindings preserved · {preview.added} new bindings</p>
        <img src={preview.url} alt="Proposed diagram from source" onLoad={() => setPainted(true)}
          onError={() => setError("The proposed diagram could not be displayed.")} />
      </section>}
      <div className="dialog-actions">
        <button className="button quiet" type="button" onClick={onClose}>Close</button>
        <button className="button quiet" type="button" disabled={!hasDraft || busy}
          onClick={() => change({ base: base.source, text: baseText, normalize: false })}>Discard draft</button>
        <button className="button secondary" type="submit" disabled={!canPreview || busy}>Preview source</button>
        <button className="button primary" type="button" disabled={!preview || !painted || busy} onClick={apply}>Apply source</button>
      </div>
    </form>
  </Modal>;
}
