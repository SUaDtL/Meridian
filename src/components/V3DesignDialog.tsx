import { useEffect, useRef, useState } from "react";
import { designRecipeIds, readDesignRecipe, type DesignRecipeId } from "../lib/authoring/design-recipes";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildExportFrame } from "../lib/export";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Candidate = NonNullable<ReturnType<Editor["readDesignPreview"]>>;
type Preview = { proposal: ReadyProposal; changes: Candidate["changes"]; url: string; width: number; height: number };

export default function V3DesignDialog({ currentUrl, currentSize, editor, onApply, onClose }: {
  currentUrl: string;
  currentSize: { width: number; height: number };
  editor: Editor;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyDesign"]>;
  onClose: () => void;
}) {
  const [recipe, setRecipe] = useState<DesignRecipeId>("clear");
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"current" | "proposed">("current");
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  function choose(next: DesignRecipeId) {
    if (recipe === next || active.current) return;
    setRecipe(next);
    setPreview(undefined);
    setPainted(false);
    setView("current");
    setError("");
  }

  async function prepare() {
    if (active.current) return;
    const work = new AbortController();
    active.current = work;
    setBusy(true);
    setPainted(false);
    setError("");
    setPreview(undefined);
    setView("current");
    try {
      const proposal = await editor.prepareDesign(recipe, work.signal);
      const candidate = editor.readDesignPreview(proposal);
      if (!candidate) throw new Error("The project changed. Refresh the design preview.");
      const { svg, width, height } = buildExportFrame(candidate.rendered.result, candidate.document);
      work.signal.throwIfAborted();
      setPreview({ proposal, changes: candidate.changes, width, height, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
      setView("proposed");
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "This design could not be previewed.");
    } finally {
      active.current = undefined;
      if (!work.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!preview || !painted || busy) return;
    const status = onApply(preview.proposal);
    if (status === "applied" || status === "unchanged") onClose();
    else {
      setPreview(undefined);
      setPainted(false);
      setView("current");
      setError(status === "stale" ? "The project changed. Refresh the design preview." : "The design could not be applied with Undo.");
    }
  }

  const recipeLabel = readDesignRecipe(recipe).title;
  function label(value: unknown) { return typeof value === "boolean" ? value ? "On" : "Off" : String(value); }
  return (
    <Modal title="Explore designs" wide onClose={onClose}>
      <p>Diagram scope · Element overrides are preserved.</p>
      <div className="recipe-options" role="group" aria-label="Design recipes">
        {designRecipeIds.map(id => {
          const choice = readDesignRecipe(id);
          return <button className="button secondary" key={id} aria-pressed={recipe === id} disabled={busy} onClick={() => choose(id)}>
            <strong>{choice.title}</strong><span>{choice.description}</span>
          </button>;
        })}
      </div>
      <div className="recovery-actions" role="group" aria-label="Comparison view">
        <button className="button quiet" aria-pressed={view === "current"} onClick={() => setView("current")}>Current</button>
        <button className="button quiet" aria-pressed={view === "proposed"} disabled={!preview} onClick={() => setView("proposed")}>Proposed</button>
      </div>
      <div className="migration-preview">
        <figure hidden={view !== "current"}>
          <img src={currentUrl} alt="Current diagram design" />
          <figcaption>Current frame · {currentSize.width} × {currentSize.height}</figcaption>
        </figure>
        {preview && <figure hidden={view !== "proposed"}>
          <img src={preview.url} alt={`Proposed ${recipeLabel} design`} onLoad={() => setPainted(true)} onError={() => setError("The proposed image could not be displayed.")} />
          <figcaption>Proposed frame · {preview.width} × {preview.height}</figcaption>
        </figure>}
      </div>
      {preview && <ul aria-label="Design changes">{preview.changes.map(change =>
        <li key={change.field}>{change.label} · {label(change.before)} → {label(change.after)}</li>)}</ul>}
      {busy && <p role="status">Rendering the {recipeLabel} design…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button secondary" disabled={busy} onClick={() => void prepare()}>Preview {recipeLabel}</button>
        <button className="button primary" disabled={!preview || !painted || busy} onClick={apply}>Apply {recipeLabel}</button>
      </div>
    </Modal>
  );
}
