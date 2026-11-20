import { useState } from "react";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;

export default function DetachComponentDialog({ editor, table, onApplied, onClose }: {
  editor: Editor;
  table?: RenderTargetTable | null;
  onApplied: () => void;
  onClose: () => void;
}) {
  const [base] = useState(editor.snapshot);
  const [id, setId] = useState("");
  const [error, setError] = useState("");
  const instance = base.componentInstances.find(item => item.id === id);
  const labels = new Map(table?.targets.map(target => [target.id, target.label]));

  function detach() {
    const result = editor.detachComponentInstance(id, base);
    if (result === "applied") { onApplied(); return; }
    setError(result === "stale" ? "The project changed. Reopen this dialog to review the current components."
      : "The project could not detach this component with Undo.");
  }

  return <Modal title="Detach component" wide onClose={onClose}>
    <form className="heading-form" onSubmit={event => { event.preventDefault(); if (instance) detach(); }}>
      <p>Detach an instance to keep its current diagram content as ordinary project elements. Undo restores the component association.</p>
      <label>Component instance
        <select value={id} onChange={event => { setId(event.target.value); setError(""); }}>
          <option value="">Choose an instance</option>
          {base.componentInstances.map((item, index) => {
            const first = item.bindings.map(binding => labels.get(binding.elementId)).find(Boolean);
            return <option key={item.id} value={item.id}>{first || "Component"} · {item.definitionVersion} · Instance {index + 1}</option>;
          })}
        </select>
      </label>
      {instance && <ul aria-label="Elements in this instance">
        {instance.bindings.map(binding => <li key={binding.localId}>{labels.get(binding.elementId) || binding.localId}</li>)}
      </ul>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button quiet" type="button" onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={!instance}>Detach instance</button>
      </div>
    </form>
  </Modal>;
}
