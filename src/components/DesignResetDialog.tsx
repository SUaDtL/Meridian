import { useEffect, useRef, useState } from "react";
import { designResetFields, styleFieldLabels, type DesignReset } from "../lib/authoring/design-reset";
import type { BaseToken } from "../lib/authoring/base-token";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildExportFrame } from "../lib/export";
import type { ElementStyle } from "../types/design";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type ResetChanges = Awaited<ReturnType<Editor["prepareDesignReset"]>>["changes"];

export default function DesignResetDialog({ editor, token, selection, hidden, initialField, onApply, onClose }: {
  editor: Editor; token: BaseToken; selection: ReadonlySet<string>; hidden: number;
  initialField?: keyof ElementStyle;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyDesignReset"]>; onClose: () => void;
}) {
  const { fields, hasRecipes } = designResetFields(editor.snapshot(), selection);
  const [layer, setLayer] = useState<DesignReset["layer"]>(fields.length ? "user" : "recipe");
  const [field, setField] = useState<keyof ElementStyle | "">(initialField && fields.includes(initialField) ? initialField : fields[0] ?? "");
  const [ready, setReady] = useState<{ proposal: ReadyProposal; url: string; changes: ResetChanges }>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => () => { if (ready) URL.revokeObjectURL(ready.url); }, [ready]);

  function clearPreview() {
    setReady(undefined);
    setPainted(false);
    setError("");
  }

  async function preview() {
    if (pending.current || (layer === "user" ? !field : !hasRecipes)) return;
    const reset: DesignReset = layer === "user" && field ? { layer, field } : { layer: "recipe" };
    const work = new AbortController();
    pending.current = work;
    setBusy(true);
    clearPreview();
    try {
      const result = await editor.prepareDesignReset(selection, reset, token, work.signal);
      const { svg } = buildExportFrame(result.rendered.result, result.next);
      work.signal.throwIfAborted();
      setReady({ proposal: result.proposal, changes: result.changes, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "The reset could not be previewed.");
    } finally {
      pending.current = undefined;
      if (!work.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!ready || !painted) return;
    const status = onApply(ready.proposal);
    if (status === "applied") onClose();
    else {
      clearPreview();
      setError(status === "stale" ? "The diagram changed. Review the current selection." : "The reset could not be applied with Undo.");
    }
  }

  return <Modal title="Reset selected styles" wide onClose={onClose}>
    <div className="heading-form">
      <p>{selection.size} selected · {hidden} hidden in the outline</p>
      <fieldset>
        <legend>Style to reset</legend>
        <label className="check-label"><input name="style-reset" type="radio" checked={layer === "user"} disabled={busy || !fields.length}
          onChange={() => { setLayer("user"); clearPreview(); }} /> Reset user override</label>
        <label className="check-label"><input name="style-reset" type="radio" checked={layer === "recipe"} disabled={busy || !hasRecipes}
          onChange={() => { setLayer("recipe"); clearPreview(); }} /> Reset selected design</label>
      </fieldset>
      {layer === "user" && <label>Property<select disabled={busy || !fields.length} value={field}
        onChange={event => { setField(event.target.value as keyof ElementStyle); clearPreview(); }}>
        {fields.map(value => <option key={value} value={value}>{styleFieldLabels[value]}</option>)}
      </select></label>}
      <p>{layer === "user" ? "Reveals the recipe or inherited value for this property."
        : "Removes recipe styling from the selection. User overrides still take precedence."}</p>
      {ready && <div className="migration-preview">
        <img src={ready.url} alt="Diagram preview after the selected style reset" onLoad={() => setPainted(true)}
          onError={() => setError("The reviewed diagram could not be displayed.")} />
        <p>{ready.changes.length} of {selection.size} selected elements have styles to reset.</p>
        <details>
          <summary>Review affected elements and inherited values</summary>
          <ul>{ready.changes.map(item => <li key={item.id}><strong>{item.label}</strong>
            <ul>{item.properties.map(property => <li key={property.field}>
              {styleFieldLabels[property.field]} · Removed {String(property.previous)} · {property.origin}
              {property.measured !== undefined ? ` · Rendered ${property.measured}` : property.retained !== undefined ? ` · ${property.retained}` : ""}
            </li>)}</ul>
          </li>)}</ul>
        </details>
      </div>}
      {busy && <p role="status">Checking the rendered reset…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button secondary" disabled={busy || (layer === "user" ? !field : !hasRecipes)} onClick={() => void preview()}>Preview reset</button>
        <button className="button primary" disabled={!ready || !painted || busy} onClick={apply}>Apply reset</button>
      </div>
    </div>
  </Modal>;
}
