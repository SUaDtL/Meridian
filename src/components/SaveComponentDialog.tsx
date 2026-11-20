import { useEffect, useRef, useState } from "react";
import type { ComponentDefinition } from "../lib/authoring/component-definition";
import { buildComponentProject } from "../lib/authoring/component-project";
import { componentFromSelection, readComponentSelection } from "../lib/authoring/component-selection";
import { curatedComponents } from "../lib/authoring/curated-components";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { renderMermaidProject } from "../lib/authoring/project-render";
import { buildExportFrame } from "../lib/export";
import { saveComponentDefinitions } from "../lib/persistence/component-library";
import { downloadText, safeFilename } from "../lib/storage";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Frame = Awaited<ReturnType<typeof renderMermaidProject>>;
type Selection = Awaited<ReturnType<typeof readComponentSelection>>;
type Review = { definition: ComponentDefinition; url: string };
const optionPageSize = 30;

export default function SaveComponentDialog({ editor, frame, selection, hidden, db, onClose }: {
  editor: Editor; frame: Frame; selection: ReadonlySet<string>; hidden: number; db: IDBDatabase; onClose: () => void;
}) {
  const [base] = useState(editor.snapshot);
  const [definitionId] = useState(() => crypto.randomUUID());
  const [contents, setContents] = useState<Selection>();
  const [name, setName] = useState("");
  const [edges, setEdges] = useState<ReadonlySet<string>>(new Set());
  const [ports, setPorts] = useState<ReadonlyMap<string, string>>(new Map());
  const [parameters, setParameters] = useState<ReadonlySet<string>>(new Set());
  const [edgeLimit, setEdgeLimit] = useState(optionPageSize);
  const [portLimit, setPortLimit] = useState(optionPageSize);
  const [review, setReview] = useState<Review>();
  const [painted, setPainted] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    void readComponentSelection(base, frame, selection).then(result => {
      if (active) setContents(result);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "The selected source could not be verified.");
    });
    return () => { active = false; pending.current?.abort(); };
  }, [base, frame, selection]);
  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url); }, [review]);

  async function run(label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(label);
    setError("");
    try { await action(controller.signal); }
    catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The component could not be saved.");
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy("");
    }
  }

  function preview() {
    if (!contents) return;
    void run("Rendering the component", async signal => {
      if (editor.snapshot() !== base) throw new Error("The project changed. Reopen this review using the current selection.");
      const definition = componentFromSelection(contents, definitionId, name, edges, ports, parameters);
      const candidate = await buildComponentProject(definition, {}, signal);
      const { svg } = buildExportFrame(candidate.rendered, candidate.document);
      signal.throwIfAborted();
      setPainted(false);
      setReview({ definition, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    });
  }

  function save() {
    if (!review || !painted || saved) return;
    void run("Saving to the library", async () => {
      if (editor.snapshot() !== base) throw new Error("The project changed. Reopen this review using the current selection.");
      await saveComponentDefinitions(db, [review.definition], curatedComponents);
      setSaved(true);
    });
  }

  function toggle(group: ReadonlySet<string>, key: string, included: boolean) {
    const next = new Set(group);
    if (included) next.add(key);
    else next.delete(key);
    return next;
  }

  return <Modal title="Save selection as component" wide busy={busy === "Saving to the library"} onClose={onClose}>
    {!contents && !error && <p role="status">Checking the selected source…</p>}
    {contents && !review && <div className="heading-form">
      <p>{contents.nodes.length} selected nodes · {hidden} hidden in the outline</p>
      <p>Copies labels, source shapes, semantic roles and reviewed connections into the component library.</p>
      <label>Component name<input value={name} maxLength={120} disabled={!!busy} onChange={event => setName(event.target.value)} /></label>
      <fieldset className="heading-form guided-process-fieldset" disabled={!!busy}>
        <legend>Node labels and parameters</legend>
        {contents.nodes.map((node, index) => <label key={node.id} className="check-label">
          <input type="checkbox" checked={parameters.has(node.id)} disabled={!parameters.has(node.id) && parameters.size === 32}
            onChange={event => setParameters(toggle(parameters, node.id, event.target.checked))} />
          Make {node.label} ({index + 1}) a text parameter
        </label>)}
      </fieldset>
      <fieldset className="heading-form guided-process-fieldset" disabled={!!busy}>
        <legend>Internal connections</legend>
        {!contents.edges.length && <p>No declared connections join the selected nodes.</p>}
        {contents.edges.slice(0, edgeLimit).map(item => <label key={item.id} className="check-label">
          <input type="checkbox" checked={edges.has(item.id)} disabled={!edges.has(item.id) && edges.size === 200}
            onChange={event => setEdges(toggle(edges, item.id, event.target.checked))} /> Include {item.summary}
        </label>)}
        {contents.edges.length > edgeLimit && <button className="button quiet" onClick={() => setEdgeLimit(value => value + optionPageSize)}>Show more connections</button>}
      </fieldset>
      {!!contents.boundaries.length && <fieldset className="heading-form guided-process-fieldset" disabled={!!busy}>
        <legend>Optional attachment ports</legend>
        <p>A port belongs to the selected node. Its outside endpoint stays in the original diagram.</p>
        {contents.boundaries.slice(0, portLimit).map(item => <div key={item.id} className="heading-form">
          <label className="check-label"><input type="checkbox" checked={ports.has(item.id)}
            disabled={!ports.has(item.id) && ports.size === 16} onChange={event => {
              const next = new Map(ports);
              if (event.target.checked) next.set(item.id, item.label);
              else next.delete(item.id);
              setPorts(next);
            }} /> Expose {item.summary} as an {item.direction === "in" ? "input" : "output"} port</label>
          {ports.has(item.id) && <label>Port label<input value={ports.get(item.id)} maxLength={120}
            onChange={event => setPorts(new Map(ports).set(item.id, event.target.value))} /></label>}
        </div>)}
        {contents.boundaries.length > portLimit && <button className="button quiet" onClick={() => setPortLimit(value => value + optionPageSize)}>Show more port candidates</button>}
      </fieldset>}
      <button className="button primary" disabled={!!busy || !name.trim() || [...ports.values()].some(label => !label.trim())}
        onClick={preview}>Preview component</button>
    </div>}
    {review && <section className="migration-preview" aria-label="Proposed component">
      <h3>{review.definition.name}</h3>
      <p>{review.definition.fragment.nodes.length} nodes · {review.definition.fragment.edges.length} connections · {review.definition.parameters.length} parameters · {review.definition.ports.length} ports</p>
      <img src={review.url} alt="Proposed reusable component" onLoad={() => setPainted(true)}
        onError={() => setError("The proposed component could not be displayed.")} />
      <div className="dialog-actions">
        {!saved && <button className="button quiet" disabled={!!busy} onClick={() => setReview(undefined)}>Back to contents</button>}
        <button className="button secondary" disabled={!!busy || !painted} onClick={() =>
          downloadText(JSON.stringify(review.definition, null, 2), `${safeFilename(review.definition.name)}.meridian-component.json`)
        }>Download component</button>
        {!saved && <button className="button primary" disabled={!!busy || !painted} onClick={save}>Save to component library</button>}
      </div>
    </section>}
    {busy && <p role="status">{busy}…</p>}
    {saved && <p role="status">Component saved in this browser.</p>}
    {error && <p role="alert">{error}</p>}
  </Modal>;
}
