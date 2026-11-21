import { useEffect, useMemo, useRef, useState } from "react";
import type { openStoredProjectEditor, StorySceneDetails, StorySceneOrderEdit } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildExportFrame } from "../lib/export";
import { createScene } from "../lib/storyboard";
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

export default function V3SavedScenesDialog({ editor, startNew, onApply, onOrderChange, onClose }: {
  editor: Editor;
  startNew: boolean;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStory"]>;
  onOrderChange: (...args: Parameters<Editor["editStorySceneOrder"]>) => ReturnType<Editor["editStorySceneOrder"]>;
  onClose: () => void;
}) {
  const [base, setBase] = useState(editor.snapshot);
  const [newScene, setNewScene] = useState(() => startNew ? createScene(base.storyboard.scenes.length) : undefined);
  const [selected, setSelected] = useState<string | undefined>(newScene?.id ?? base.storyboard.scenes[0]?.id);
  const selectedIndex = base.storyboard.scenes.findIndex(item => item.id === selected);
  const creating = !!newScene && selected === newScene.id;
  const scene = creating ? newScene : selectedIndex < 0 ? undefined : base.storyboard.scenes[selectedIndex];
  const [drafts, setDrafts] = useState(new Map<string, StorySceneDetails>());
  const draft = scene ? drafts.get(scene.id) ?? sceneDetails(scene) : undefined;
  const [review, setReview] = useState<Review>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmRemoval, setConfirmRemoval] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const cancelRemoval = useRef<HTMLButtonElement>(null);
  const empty = useRef<HTMLParagraphElement>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const previewScenes = useMemo(() => review ? [review.scene] : [], [review]);
  const changed = !!scene && JSON.stringify(draft) !== JSON.stringify(sceneDetails(scene));
  useEffect(() => () => operation.current?.abort(), []);

  function resetReview() {
    setReview(undefined);
    setReady(false);
    setError("");
    setStatus("");
  }

  function change(next: StorySceneDetails) {
    if (!selected) return;
    setDrafts(previous => new Map(previous).set(selected, next));
    resetReview();
  }

  async function prepare() {
    if (!selected || !draft || (!creating && !changed) || operation.current) return;
    const work = new AbortController();
    operation.current = work;
    setBusy(true);
    setReady(false);
    setReview(undefined);
    setError("");
    try {
      const proposal = await editor.prepareStoryScene(creating ? null : selected, draft, base, work.signal);
      const result = editor.readStoryPreview(proposal);
      const edited = creating ? result?.next.storyboard.scenes.at(-1) : result?.next.storyboard.scenes.find(item => item.id === selected);
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
    if (!selected || !review || !ready || busy) return;
    const result = onApply(review.proposal);
    if (result === "applied") {
      const id = review.scene.id;
      setBase(editor.snapshot());
      setDrafts(previous => {
        const next = new Map(previous);
        next.delete(selected);
        return next;
      });
      if (creating) {
        setSelected(id);
        setNewScene(undefined);
      }
      resetReview();
      setStatus(creating ? "Scene added to the storyboard." : "Scene updated.");
      requestAnimationFrame(() => cards.current.get(id)?.focus());
    } else {
      setReview(undefined);
      setReady(false);
      setError(result === "stale" ? "The project changed. Open the current story again." : "The scene could not be applied with Undo.");
    }
  }

  function startScene() {
    const draftScene = newScene ?? createScene(base.storyboard.scenes.length);
    setNewScene(draftScene);
    setSelected(draftScene.id);
    setConfirmRemoval(false);
    resetReview();
    requestAnimationFrame(() => titleField.current?.focus());
  }

  function cancelNewScene() {
    setDrafts(previous => {
      const remaining = new Map(previous);
      if (newScene) remaining.delete(newScene.id);
      return remaining;
    });
    setNewScene(undefined);
    setSelected(base.storyboard.scenes[0]?.id);
    resetReview();
    requestAnimationFrame(() => add.current?.focus());
  }

  function editOrder(action: StorySceneOrderEdit) {
    if (!selected || busy) return;
    const result = onOrderChange(selected, action, base);
    if (result !== "applied") {
      setError(result === "stale" ? "The project changed. Open the current story again." : "The scene order could not be changed with Undo.");
      return;
    }
    const next = editor.snapshot();
    setBase(next);
    resetReview();
    setConfirmRemoval(false);
    if (action === "remove") {
      setDrafts(previous => {
        const remaining = new Map(previous);
        remaining.delete(selected);
        return remaining;
      });
      const neighbor = next.storyboard.scenes[selectedIndex] ?? next.storyboard.scenes.at(-1);
      setSelected(neighbor?.id);
      setStatus("Scene deleted.");
      requestAnimationFrame(() => (neighbor ? cards.current.get(neighbor.id) : empty.current)?.focus());
    } else {
      const position = next.storyboard.scenes.findIndex(item => item.id === selected) + 1;
      setStatus(`Scene moved to position ${position} of ${next.storyboard.scenes.length}.`);
      requestAnimationFrame(() => cards.current.get(selected)?.focus());
    }
  }

  return <Modal title="Edit saved scenes" wide onClose={onClose} initialFocus={startNew ? "[name='scene-title']" : "[aria-pressed='true']"}>
    <button type="button" className="button secondary" ref={add} disabled={busy || creating || base.storyboard.scenes.length >= 50}
      onClick={startScene}>{newScene && !creating ? "Resume new overview scene" : "New overview scene"}</button>
    <ol className="project-list" aria-label="Saved scenes">{base.storyboard.scenes.map((item, index) => (
      <li className="project-row" key={item.id}>
        <button type="button" className="button quiet" aria-pressed={item.id === selected} disabled={busy}
          ref={button => { if (button) cards.current.set(item.id, button); else cards.current.delete(item.id); }}
          onClick={() => { setSelected(item.id); setConfirmRemoval(false); resetReview(); }}>
          {index + 1}. {item.title || "Untitled scene"} · {item.duration} s
        </button>
      </li>
    ))}</ol>
    {!scene && <p ref={empty} tabIndex={-1}>No saved scenes.</p>}
    {scene && !creating && <div className="dialog-actions" role="group" aria-label="Selected scene order">
      <button type="button" className="button quiet" disabled={busy || confirmRemoval || selectedIndex === 0}
        onClick={() => editOrder("earlier")}>Move earlier</button>
      <button type="button" className="button quiet" disabled={busy || confirmRemoval || selectedIndex === base.storyboard.scenes.length - 1}
        onClick={() => editOrder("later")}>Move later</button>
      <button type="button" className="button secondary" disabled={busy || confirmRemoval} onClick={() => {
        resetReview(); setConfirmRemoval(true);
        requestAnimationFrame(() => cancelRemoval.current?.focus());
      }}>Delete scene</button>
    </div>}
    {scene && confirmRemoval && <div className="heading-form">
      <p>Delete “{scene.title || "Untitled scene"}” from this storyboard?{changed ? " Its unsaved edits will be discarded." : ""}</p>
      <div className="dialog-actions">
        <button type="button" className="button quiet" ref={cancelRemoval} onClick={() => {
          setConfirmRemoval(false); setError(""); cards.current.get(scene.id)?.focus();
        }}>Keep scene</button>
        <button type="button" className="button primary" onClick={() => editOrder("remove")}>Delete selected scene</button>
      </div>
    </div>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    {scene && draft && !confirmRemoval && <form className="heading-form" onSubmit={event => { event.preventDefault(); void prepare(); }}>
      {creating && <p>The overview shows the entire diagram. Preview it before adding it to the end of the story.</p>}
      <label>Scene title<input ref={titleField} name="scene-title" value={draft.title} maxLength={120} disabled={busy} onChange={event => change({ ...draft, title: event.target.value })} /></label>
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
      {review && <section aria-label="Proposed scene">
        <StoryPreviewPlayer svg={review.svg} story={previewScenes} table={review.result.rendered.targetTable!}
          accent={getTheme(base.settings.theme).accent} onReady={setReady} />
      </section>}
      <div className="dialog-actions">
        {creating && <button className="button quiet" type="button" disabled={busy} onClick={cancelNewScene}>Cancel new scene</button>}
        <button className="button secondary" type="submit" disabled={(!creating && !changed) || busy}>{creating ? "Preview new scene" : "Preview scene edit"}</button>
        <button className="button primary" type="button" disabled={!review || !ready || busy} onClick={apply}>{creating ? "Add reviewed scene" : "Apply scene edit"}</button>
      </div>
    </form>}
  </Modal>;
}
