import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { authoringLimits } from "../lib/authoring/flowchart-source";
import { IdentityLimitError } from "../lib/authoring/identities";
import type { MermaidProjectV3 } from "../lib/authoring/mermaid-project";
import { sourceLineEndings } from "../lib/authoring/manual-source";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import { renderMermaidProject } from "../lib/authoring/project-render";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { sourceLineRange, SourceDiagnosticError } from "../lib/authoring/source-diagnostics";
import { readMatchingSourceRecovery, serializeSourceRecovery, sourceRecoveryByteLimit, type SourceRecoveryReason } from "../lib/authoring/source-recovery";
import { PortableProjectLimitError } from "../lib/authoring/validate-mermaid-project";
import { downloadText, safeFilename } from "../lib/storage";
import { missingNodeBracket } from "../lib/authoring/source-diagnostic-repair";
import { buildExportFrame } from "../lib/export";
import Modal from "./Modal";
import SourceEditor from "./SourceEditor";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Prepared = Awaited<ReturnType<Editor["prepareSource"]>>;
export type SourceDraft = { base: string; text: string; normalize: boolean; recovery?: SourceRecoveryReason };
const diagnosticTitles = { syntax: "Mermaid syntax", resource: "Resource restriction", unsupported: "Reviewed editing limitation", stale: "Stale preview" };

type Caret = { anchor: number; head: number };
type Repair = NonNullable<ReturnType<typeof missingNodeBracket>> & { base: MermaidProjectV3; draft: SourceDraft };

function mapSourceCaret(before: string, after: string, selected: Caret): Caret {
  let prefix = 0;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (prefix < oldEnd && prefix < newEnd && before[prefix] === after[prefix]) prefix++;
  while (oldEnd > prefix && newEnd > prefix && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const map = (offset: number) => offset <= prefix ? offset : offset >= oldEnd
    ? offset + newEnd - oldEnd : Math.min(offset, newEnd);
  return { anchor: map(selected.anchor), head: map(selected.head) };
}

export default function V3SourceEditor({ editor, savedDraft, onDraft, onApply, onClose, canUndo, canRedo, onHistory }: {
  editor: Editor;
  savedDraft?: SourceDraft;
  onDraft: (draft: SourceDraft) => void;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStructure"]>["status"];
  onClose: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onHistory: (direction: "undo" | "redo") => MermaidProjectV3 | undefined;
}) {
  const [base, setBase] = useState(editor.snapshot);
  const baseText = base.source.replace(/\r\n?/g, "\n");
  const [draft, setDraft] = useState<SourceDraft>(() => savedDraft?.base === base.source ? savedDraft
    : { base: base.source, text: baseText, normalize: false });
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [recoveryError, setRecoveryError] = useState("");
  const recoveryInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | SourceDiagnosticError>("");
  const [repair, setRepair] = useState<Repair>();
  const [repairMessage, setRepairMessage] = useState("");
  const [preview, setPreview] = useState<(Prepared & { url: string })>();
  const [painted, setPainted] = useState(false);
  const request = useRef<AbortController | null>(null);
  const input = useRef<EditorView>(null);
  const restoredCaret = useRef<Caret | undefined>(undefined);
  const [editorInstance, setEditorInstance] = useState(0);
  const lineEndings = sourceLineEndings(base.source);
  const source = lineEndings === "crlf" ? draft.text.replace(/\n/g, "\r\n") : draft.text;
  const canPreview = !composing && source !== base.source && (lineEndings !== "mixed" || draft.normalize);
  const hasDraft = draft.text !== baseText || draft.normalize;
  const locked = busy || recovering;
  const actionsBlocked = locked || composing;
  const diagnostic = error instanceof SourceDiagnosticError ? error : undefined;
  const affectedLine = diagnostic?.line;
  const location = affectedLine ? sourceLineRange(draft.text, affectedLine) : undefined;
  const staleRepair = repair && (repair.draft !== draft || repair.base !== base || editor.snapshot() !== base);

  function repairDraft() {
    const view = input.current;
    if (!repair || actionsBlocked || !view || view.composing) return;
    if (staleRepair || view.state.doc.toString() !== repair.draft.text) {
      setRepairMessage("The draft changed after this fix was reviewed. Preview the current source for a fresh fix.");
      return;
    }
    view.dispatch({ changes: { from: repair.insertAt, insert: "]" }, selection: { anchor: repair.insertAt + 1 }, scrollIntoView: true });
    setRepair(undefined);
    setRepairMessage("The bracket was added to the draft. Preview the source before applying the edit.");
    view.focus();
  }


  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  function change(next: SourceDraft) {
    setDraft(next);
    onDraft(next);
    setPreview(undefined);
    setPainted(false);
    setError("");
    setRecoveryMessage("");
    setRecoveryError("");
    setRepairMessage("");
  }

  async function useRecovery(action: (signal: AbortSignal) => Promise<void>) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setRecovering(true);
    setRecoveryMessage("");
    setRecoveryError("");
    try { await action(controller.signal); }
    catch (reason) {
      if (!controller.signal.aborted) setRecoveryError(reason instanceof Error ? reason.message : "The source recovery file could not be used.");
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setRecovering(false);
    }
  }

  function downloadRecovery() {
    const reason = draft.recovery;
    if (!reason) return;
    void useRecovery(async signal => {
      const text = await serializeSourceRecovery(base, source, reason);
      signal.throwIfAborted();
      downloadText(text, `${safeFilename(base.title)}.meridian-recovery.json`);
      setRecoveryMessage("Recovery file downloaded with the accepted project and source draft.");
    });
  }

  function restoreRecovery(file: File) {
    if (hasDraft || composing) return;
    void useRecovery(async signal => {
      if (file.size > sourceRecoveryByteLimit) throw new Error("Choose a Meridian recovery file no larger than 4,000,000 bytes.");
      const fileText = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
      const recovered = await readMatchingSourceRecovery(fileText, base);
      signal.throwIfAborted();
      if (editor.snapshot() !== base) throw new Error("The project changed. Reopen source review before restoring this draft.");
      const text = recovered.sourceDraft.replace(/\r\n?/g, "\n");
      const restored = lineEndings === "crlf" ? text.replace(/\n/g, "\r\n") : text;
      if (restored !== recovered.sourceDraft) throw new Error("The recovery draft uses different line endings from the open source editor.");
      change({ base: base.source, text, normalize: lineEndings === "mixed", recovery: recovered.reason });
      setRecoveryMessage("Source draft restored. Preview it before applying any changes.");
      setEditorInstance(instance => instance + 1);
    });
  }

  function history(direction: "undo" | "redo") {
    if (hasDraft || actionsBlocked || input.current?.composing || editor.snapshot() !== base) return;
    const caret = input.current?.state.selection.main;
    const next = onHistory(direction);
    if (!next) return;
    const text = next.source.replace(/\r\n?/g, "\n");
    if (caret) restoredCaret.current = mapSourceCaret(baseText, text, caret);
    setBase(next);
    change({ base: next.source, text, normalize: false });
    setEditorInstance(instance => instance + 1);
  }

  async function prepare() {
    if (!canPreview || input.current?.composing || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setPreview(undefined);
    setPainted(false);
    setRepair(undefined);
    setRepairMessage("");
    setError("");
    try {
      const checked = await editor.prepareSource(source, base, controller.signal);
      const candidate = editor.readStructurePreview(checked.proposal);
      if (!candidate) throw new SourceDiagnosticError("stale", "The project changed. Reopen the editor to review the current revision.");
      const rendered = await renderMermaidProject(candidate, controller.signal, "preview");
      controller.signal.throwIfAborted();
      if (!rendered.targetTable) throw new Error("The preview could not resolve the project’s diagram targets.");
      const svg = buildExportFrame(rendered.result, candidate).svg;
      setPreview({ ...checked, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof SourceDiagnosticError ? reason
          : reason instanceof Error ? reason.message : "The revised source could not be previewed.");
        if (reason instanceof SourceDiagnosticError) {
          const suggestion = missingNodeBracket(draft.text, reason);
          if (suggestion) setRepair({ ...suggestion, base, draft });
        }
        const recovery = reason instanceof IdentityLimitError ? reason.reason
          : reason instanceof PortableProjectLimitError ? "project-size" : undefined;
        if (recovery) {
          const retained = { ...draft, recovery };
          setDraft(retained);
          onDraft(retained);
        }
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!preview || !painted || actionsBlocked || input.current?.composing) return;
    const status = onApply(preview.proposal);
    if (status === "applied") onClose();
    else {
      setPreview(undefined);
      setError(status === "stale" ? new SourceDiagnosticError("stale", "The project changed. Reopen the editor to review the current revision.")
        : "The source could not be applied with Undo.");
    }
  }

  return <Modal title="Edit Mermaid source" wide onClose={onClose} initialFocus=".v3-source-draft .cm-content" busy={composing}>
    <form className="heading-form" onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <p>Preview and apply source changes that keep the current diagram’s bindings. The draft stays in this session until you apply or discard it.</p>
      <div className="v3-source-draft">
        <SourceEditor key={editorInstance} source={draft.text} onChange={text => change({ base: draft.base, normalize: draft.normalize, text })}
          draft={{ readOnly: locked, onComposition: setComposing, maxLength: authoringLimits.sourceCodeUnits, onReady: view => {
            input.current = view;
            if (restoredCaret.current) {
              view.dispatch({ selection: restoredCaret.current, scrollIntoView: true });
              restoredCaret.current = undefined;
            }
            view.focus();
          } }} />
      </div>
      {lineEndings === "mixed" && <label className="check-label">
        <input type="checkbox" disabled={actionsBlocked} checked={draft.normalize}
          onChange={event => change({ base: draft.base, text: draft.text, normalize: event.target.checked })} />
        Use LF line endings for this edit
      </label>}
      {busy && <p role="status">Checking and rendering the revised source…</p>}
      {error && <div>
        <div role="alert">
          {diagnostic ? <><strong>{diagnosticTitles[diagnostic.kind]}{affectedLine && ` · Line ${affectedLine}`}</strong>
            <p>{diagnostic.message}</p></> : <p>{String(error)}</p>}
        </div>
        {location && <button className="button quiet" type="button" disabled={composing} onClick={() => {
          input.current?.dispatch({ selection: { anchor: location.start, head: location.end }, scrollIntoView: true });
          input.current?.focus();
        }}>Go to line {affectedLine}</button>}
        {diagnostic?.detail && <details><summary>Mermaid parser details</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{diagnostic.detail}</pre>
        </details>}
      </div>}
      {repair && <section aria-label="Reviewed diagnostic fix">
        <p>Add a closing bracket on line {repair.line}.</p>
        <p>Current line <code>{repair.before}</code></p>
        <p>Proposed line <code>{repair.after}</code></p>
        {staleRepair && <p>Preview the current source to refresh this fix.</p>}
        <button className="button secondary" type="button" disabled={actionsBlocked} onClick={repairDraft}>Apply fix to draft</button>
      </section>}
      {repairMessage && <p role="status">{repairMessage}</p>}
      <div className="recovery-actions" role="group" aria-label="Project history">
        <button className="button quiet" type="button" disabled={hasDraft || actionsBlocked || !canUndo} onClick={() => history("undo")}>Undo project edit</button>
        <button className="button quiet" type="button" disabled={hasDraft || actionsBlocked || !canRedo} onClick={() => history("redo")}>Redo project edit</button>
      </div>
      <details open={!!draft.recovery || undefined}>
        <summary>Source recovery file</summary>
        <input ref={recoveryInput} type="file" accept=".json,application/json" aria-label="Source recovery file" hidden onChange={event => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) restoreRecovery(file);
        }} />
        {hasDraft && !draft.recovery && <p>Discard the current draft before restoring a different file.</p>}
        <div className="dialog-actions">
          {draft.recovery && <button className="button secondary" type="button" disabled={actionsBlocked} onClick={downloadRecovery}>Download source recovery file</button>}
          <button className="button secondary" type="button" disabled={actionsBlocked || hasDraft} onClick={() => recoveryInput.current?.click()}>Restore source recovery file</button>
        </div>
        {recovering && <p role="status">Checking the source recovery file…</p>}
        {recoveryMessage && <p role="status">{recoveryMessage}</p>}
        {recoveryError && <p role="alert">{recoveryError}</p>}
      </details>
      {preview && <section aria-label="Proposed source edit" className="migration-preview">
        <p>{preview.preserved} existing bindings preserved · {preview.added} new bindings</p>
        <img src={preview.url} alt="Proposed diagram from source" onLoad={() => setPainted(true)}
          onError={() => setError("The proposed diagram could not be displayed.")} />
      </section>}
      <div className="dialog-actions">
        <button className="button quiet" type="button" disabled={composing} onClick={onClose}>Close</button>
        <button className="button quiet" type="button" disabled={!hasDraft || actionsBlocked}
          onClick={() => {
            change({ base: base.source, text: baseText, normalize: false });
            setEditorInstance(count => count + 1);
          }}>Discard draft</button>
        <button className="button secondary" type="submit" disabled={!canPreview || actionsBlocked}>Preview source</button>
        <button className="button primary" type="button" disabled={!preview || !painted || actionsBlocked} onClick={apply}>Apply source</button>
      </div>
    </form>
  </Modal>;
}
