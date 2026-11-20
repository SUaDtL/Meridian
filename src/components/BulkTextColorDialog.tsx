import { useEffect, useRef, useState } from "react";
import { bulkTextSelection } from "../lib/authoring/bulk-text";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { renderMermaidProject } from "../lib/authoring/project-render";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildExportFrame } from "../lib/export";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Frame = Awaited<ReturnType<typeof renderMermaidProject>>;
const hexColor = /^#[0-9a-f]{6}$/i;

export default function BulkTextColorDialog({ editor, frame, selection, hidden, onApply, onClose }: {
  editor: Editor; frame: Frame; selection: ReadonlySet<string>; hidden: number;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyBulkText"]>; onClose: () => void;
}) {
  const scope = bulkTextSelection(frame, selection);
  const [color, setColor] = useState(scope.color ?? "");
  const [ready, setReady] = useState<{ proposal: ReadyProposal; url: string }>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => { if (ready) URL.revokeObjectURL(ready.url); }, [ready]);

  async function preview() {
    if (!frame.targetTable || pending.current || !hexColor.test(color)) return;
    const work = new AbortController();
    pending.current = work;
    setBusy(true);
    setError("");
    setPainted(false);
    try {
      const result = await editor.prepareBulkText(selection, color.toLowerCase(), frame.targetTable.baseToken, work.signal);
      const { svg } = buildExportFrame(result.preview.result, result.next);
      work.signal.throwIfAborted();
      setReady({ proposal: result.proposal, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "The selected text color could not be previewed.");
    } finally {
      pending.current = null;
      if (!work.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!ready || !painted) return;
    const result = onApply(ready.proposal);
    if (result === "applied") onClose();
    else {
      setReady(undefined);
      setError(result === "stale" ? "The diagram changed. Review the current selection again." : "The change could not be applied with Undo.");
    }
  }

  return <Modal title="Change selected text color" wide onClose={onClose}>
    <div className="heading-form">
      <p role="status">{scope.eligible.length} eligible of {scope.total} selected · {hidden} hidden in the outline</p>
      {!!scope.eligible.length && <p>Current text color {scope.color ?? "Mixed"}</p>}
      {scope.eligible.length < scope.total && <p>Labels with a verified text color are eligible for this change.</p>}
      {scope.eligible.length > 0 && <details>
        <summary>Review {scope.eligible.length} eligible labels</summary>
        <ul>{scope.eligible.map(item => <li key={item.id}>{item.label || "Unnamed label"}</li>)}</ul>
      </details>}
      {!ready && <form className="heading-form" onSubmit={event => { event.preventDefault(); void preview(); }}>
        <label>New text color<input type="text" value={color} maxLength={7} placeholder="#000000"
          disabled={!scope.eligible.length || busy} onChange={event => setColor(event.target.value)} /></label>
        <div className="dialog-actions">
          <button className="button primary" disabled={!scope.eligible.length || !hexColor.test(color) || busy}>Preview text color</button>
        </div>
      </form>}
      {ready && <div className="migration-preview">
        <img src={ready.url} alt="Diagram preview with selected text color" onLoad={() => setPainted(true)}
          onError={() => setError("The reviewed diagram could not be displayed.")} />
        <div className="dialog-actions">
          <button className="button quiet" onClick={() => setReady(undefined)}>Back to color</button>
          <button className="button primary" disabled={!painted} onClick={apply}>Apply to {scope.eligible.length} eligible labels</button>
        </div>
      </div>}
      {busy && <p role="status">Checking the rendered text color…</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}
