import { useEffect, useMemo, useRef, useState } from "react";
import type { openStoredProjectEditor, StorySceneDetails } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildExportFrame } from "../lib/export";
import { getTheme } from "../lib/themes";
import type { StoryScene } from "../types/storyboard";
import Modal from "./Modal";
import StoryPreviewPlayer from "./StoryPreviewPlayer";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Review = { proposal: ReadyProposal; scene: StoryScene; svg: string; result: NonNullable<ReturnType<Editor["readStoryPreview"]>> };

function sceneDetails(scene: StoryScene): StorySceneDetails {
  return { title: scene.title, duration: scene.duration, transition: scene.transition,
    easing: scene.easing, reveal: scene.reveal, padding: scene.camera.padding };
}

export default function V3SavedScenesDialog({ editor, onApply, onClose }: {
  editor: Editor;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStory"]>;
  onClose: () => void;
}) {
  const [base, setBase] = useState(editor.snapshot);
  const [selected, setSelected] = useState(base.storyboard.scenes[0].id);
  const scene = base.storyboard.scenes.find(item => item.id === selected)!;
  const [drafts, setDrafts] = useState(new Map<string, StorySceneDetails>());
  const draft = drafts.get(selected) ?? sceneDetails(scene);
  const [review, setReview] = useState<Review>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const operation = useRef<AbortController | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const previewScenes = useMemo(() => review ? [review.scene] : [], [review]);
  const changed = JSON.stringify(draft) !== JSON.stringify(sceneDetails(scene));
  useEffect(() => () => operation.current?.abort(), []);

  function resetReview() {
    setReview(undefined);
    setReady(false);
    setError("");
    setStatus("");
  }

  function change(next: StorySceneDetails) {
    setDrafts(previous => new Map(previous).set(selected, next));
    resetReview();
  }

  async function prepare() {
    if (!changed || operation.current) return;
    const work = new AbortController();
    operation.current = work;
    setBusy(true);
    setReady(false);
    setReview(undefined);
    setError("");
    try {
      const proposal = await editor.prepareStoryScene(selected, draft, base, work.signal);
      const result = editor.readStoryPreview(proposal);
      const edited = result?.next.storyboard.scenes.find(item => item.id === selected);
      if (!edited || !result?.rendered.targetTable) throw new Error("The project changed. Open the current story again.");
      const { svg } = buildExportFrame(result.rendered.result, result.next, { animated: true });
      work.signal.throwIfAborted();
      setReview({ proposal, scene: edited, svg, result });
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "The scene could not be previewed.");
    } finally {
      operation.current = null;
      if (!work.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!review || !ready || busy) return;
    const result = onApply(review.proposal);
    if (result === "applied") {
      setBase(editor.snapshot());
      setDrafts(previous => {
        const next = new Map(previous);
        next.delete(selected);
        return next;
      });
      resetReview();
      setStatus("Scene updated.");
      requestAnimationFrame(() => cards.current.get(selected)?.focus());
    } else {
      setReview(undefined);
      setReady(false);
      setError(result === "stale" ? "The project changed. Open the current story again." : "The scene could not be applied with Undo.");
    }
  }

  return <Modal title="Edit saved scenes" wide onClose={onClose} initialFocus="[aria-pressed='true']">
    <ol className="project-list" aria-label="Saved scenes">{base.storyboard.scenes.map((item, index) => (
      <li className="project-row" key={item.id}>
        <button type="button" className="button quiet" aria-pressed={item.id === selected} disabled={busy}
          ref={button => { if (button) cards.current.set(item.id, button); else cards.current.delete(item.id); }}
          onClick={() => { setSelected(item.id); resetReview(); }}>
          {index + 1}. {item.title || "Untitled scene"} · {item.duration} s
        </button>
      </li>
    ))}</ol>
    <form className="heading-form" onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <label>Scene title<input value={draft.title} maxLength={120} disabled={busy} onChange={event => change({ ...draft, title: event.target.value })} /></label>
      <label>Duration in seconds<input type="number" step="any" min={0.5} max={120} required disabled={busy}
        value={Number.isNaN(draft.duration) ? "" : draft.duration} onChange={event => change({ ...draft, duration: event.target.valueAsNumber })} /></label>
      <label>Entrance in seconds<input type="number" step="any" min={0} max={Math.min(10, draft.duration || 10)} required disabled={busy}
        value={Number.isNaN(draft.transition) ? "" : draft.transition} onChange={event => change({ ...draft, transition: event.target.valueAsNumber })} /></label>
      <label>Entrance easing<select value={draft.easing} disabled={busy}
        onChange={event => change({ ...draft, easing: event.target.value as StoryScene["easing"] })}>
        <option value="linear">Linear</option><option value="ease-in-out">Ease in and out</option><option value="ease-out">Ease out</option>
      </select></label>
      <label>Reveal order<select value={draft.reveal} disabled={busy}
        onChange={event => change({ ...draft, reveal: event.target.value as StoryScene["reveal"] })}>
        <option value="together">Together</option><option value="sequence">In sequence</option>
      </select></label>
      {scene.camera.mode === "elements" && <label>Camera padding in diagram units
        <input type="number" step="any" min={8} max={240} required disabled={busy} value={Number.isNaN(draft.padding) ? "" : draft.padding}
          onChange={event => change({ ...draft, padding: event.target.valueAsNumber })} />
      </label>}
      {busy && <p role="status">Preparing the scene preview…</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert">{error}</p>}
      {review && <section aria-label="Proposed scene">
        <StoryPreviewPlayer svg={review.svg} story={previewScenes} table={review.result.rendered.targetTable!}
          accent={getTheme(base.settings.theme).accent} onReady={setReady} />
      </section>}
      <div className="dialog-actions">
        <button className="button secondary" type="submit" disabled={!changed || busy}>Preview scene edit</button>
        <button className="button primary" type="button" disabled={!review || !ready || busy} onClick={apply}>Apply scene edit</button>
      </div>
    </form>
  </Modal>;
}
