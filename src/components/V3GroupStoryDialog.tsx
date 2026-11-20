import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { GroupStoryChoice, GroupStoryOptions } from "../lib/authoring/group-story";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { buildExportFrame } from "../lib/export";
import { createStoryboardPlayer } from "../lib/storyboard-runtime";
import { getTheme } from "../lib/themes";
import type { StoryboardController, StoryPlaybackState, StoryScene } from "../types/storyboard";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type StoryPreview = NonNullable<ReturnType<Editor["readStoryPreview"]>>;
export type GroupStoryDraft = GroupStoryOptions & { destination: "append" | "replace" };
export const initialGroupStoryDraft: GroupStoryDraft = { groups: [], overview: true, ungrouped: false, animate: false, duration: 5, destination: "append" };
const count = (value: number, noun: string) => `${value} ${noun}${value === 1 ? "" : "s"}`;

export default function V3GroupStoryDialog({ editor, table, draft, onDraft, onApply, onClose }: {
  editor: Editor;
  table: RenderTargetTable;
  draft: GroupStoryDraft;
  onDraft: Dispatch<SetStateAction<GroupStoryDraft>>;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyStory"]>;
  onClose: () => void;
}) {
  const [prepared, setPrepared] = useState<{ proposal: ReadyProposal; result: StoryPreview; svg: string }>();
  const [busy, setBusy] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | undefined>(undefined);
  const scenes = useMemo(() => prepared?.result.suggestions.map(item => item.scene) ?? [], [prepared]);
  const existing = editor.snapshot().storyboard.scenes;
  const groups = table.targets.filter(target => target.elementKind === "group");
  const canIncludeUngrouped = table.targets.some(target => target.elementKind === "node" && target.parentId === null);
  const total = draft.groups.length + Number(draft.overview) + Number(draft.ungrouped);
  useEffect(() => () => pending.current?.abort(), []);

  function pick(id: string, included: boolean) {
    onDraft(current => ({ ...current, groups: included ? [...current.groups, { id, depth: 1, boundary: false }]
      : current.groups.filter(choice => choice.id !== id) }));
  }

  function editGroup(id: string, change: Partial<GroupStoryChoice>) {
    onDraft(current => ({ ...current, groups: current.groups.map(choice => choice.id === id ? { ...choice, ...change } : choice) }));
  }

  function moveGroup(index: number, offset: -1 | 1) {
    onDraft(current => {
      const next = [...current.groups];
      const neighbor = index + offset;
      [next[index], next[neighbor]] = [next[neighbor], next[index]];
      return { ...current, groups: next };
    });
  }

  async function prepare() {
    if (!total || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setPreviewReady(false);
    try {
      const { destination, ...options } = draft;
      const proposal = await editor.prepareGroupStory(options, destination, controller.signal);
      const result = editor.readStoryPreview(proposal);
      if (!result?.rendered.targetTable) throw new Error("The project changed. Prepare the story preview again.");
      const { svg } = buildExportFrame(result.rendered.result, result.next, { animated: true });
      controller.signal.throwIfAborted();
      setPrepared({ proposal, result, svg });
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "The story could not be prepared.");
    } finally {
      pending.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (!prepared || !previewReady) return;
    const status = onApply(prepared.proposal);
    if (status === "applied") onClose();
    else {
      setPrepared(undefined);
      setError(status === "stale" ? "The project changed. Prepare the story preview again." : "The scene changes could not be applied with Undo.");
    }
  }

  return (
    <Modal title="Suggest scenes" wide onClose={onClose}>
      {!prepared && <div className="heading-form">
        <fieldset className="guided-process-fieldset" disabled={busy}>
          <legend>Overview by groups</legend>
          <label className="check-label"><input type="checkbox" checked={draft.overview}
            onChange={event => onDraft(current => ({ ...current, overview: event.target.checked }))} /> Include a diagram overview</label>
          {groups.map(group => <label className="check-label" key={group.id}><input type="checkbox" checked={draft.groups.some(choice => choice.id === group.id)}
            onChange={event => pick(group.id, event.target.checked)} /> Include group {group.label || "Unnamed group"}</label>)}
          {canIncludeUngrouped && <label className="check-label"><input type="checkbox" checked={draft.ungrouped}
            onChange={event => onDraft(current => ({ ...current, ungrouped: event.target.checked }))} /> Include ungrouped nodes</label>}
        </fieldset>
        {draft.groups.length > 0 && <ol aria-label="Group scene order" className="guided-process-connections">{draft.groups.map((choice, index) => {
          const name = groups.find(group => group.id === choice.id)?.label || "Unnamed group";
          return <li key={choice.id}><fieldset className="heading-form guided-process-fieldset" disabled={busy}>
            <legend>{name}</legend>
            <label>Scene title<input maxLength={120} value={choice.title ?? ""} placeholder={name} onChange={event => editGroup(choice.id, { title: event.target.value })} /></label>
            <label>Group depth<select value={choice.depth} onChange={event => editGroup(choice.id, { depth: Number(event.target.value) })}>
              {[1, 2, 3, 4].map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <label className="check-label"><input type="checkbox" checked={choice.boundary} onChange={event => editGroup(choice.id, { boundary: event.target.checked })} /> Include one-hop boundary connections</label>
            <div className="recovery-actions">
              <button className="button quiet" disabled={index === 0} onClick={() => moveGroup(index, -1)}>Move earlier</button>
              <button className="button quiet" disabled={index === draft.groups.length - 1} onClick={() => moveGroup(index, 1)}>Move later</button>
            </div>
          </fieldset></li>;
        })}</ol>}
        <label>Scene duration in seconds<input type="number" min={0.5} max={120} step={0.5} value={Number.isFinite(draft.duration) ? draft.duration : ""} disabled={busy}
          onChange={event => onDraft(current => ({ ...current, duration: event.target.valueAsNumber }))} /></label>
        <label className="check-label"><input type="checkbox" checked={draft.animate} disabled={busy}
          onChange={event => onDraft(current => ({ ...current, animate: event.target.checked }))} /> Animate visible directional connections</label>
        <label>Apply to storyboard<select value={draft.destination} disabled={busy}
          onChange={event => onDraft(current => ({ ...current, destination: event.target.value === "replace" ? "replace" : "append" }))}>
          <option value="append">Append scenes</option><option value="replace">Replace scenes</option>
        </select></label>
        {draft.destination === "replace" && existing.length > 0 && <p>Replace {existing.length} current scenes: {existing.map(scene => scene.title || "Untitled scene").join(", ")}</p>}
        <div className="dialog-actions"><button className="button primary" disabled={busy || total === 0} onClick={() => void prepare()}>Preview {total} {total === 1 ? "scene" : "scenes"}</button></div>
      </div>}
      {busy && <p role="status">Checking the current diagram and preparing scenes…</p>}
      {error && <p role="alert">{error}</p>}
      {prepared && <>
        <StoryPreviewPlayer svg={prepared.svg} story={scenes}
          table={prepared.result.rendered.targetTable!} accent={getTheme(prepared.result.next.settings.theme).accent} onReady={setPreviewReady} />
        <ul aria-label="Suggested scene coverage">{prepared.result.suggestions.map(({ scene, coverage }) => <li key={scene.id}>
          <strong>{scene.title}</strong><p>{count(coverage.node.shown, "node")}, {count(coverage.edge.shown, "connection")}, and {count(coverage.group.shown, "group")} shown.</p>
          <p>{count(coverage.node.omitted, "node")}, {count(coverage.edge.omitted, "connection")}, and {count(coverage.group.omitted, "group")} omitted.</p>
        </li>)}</ul>
        <div className="dialog-actions">
          <button className="button quiet" onClick={() => setPrepared(undefined)}>Back to scene choices</button>
          <button className="button primary" disabled={!previewReady} onClick={apply}>{draft.destination === "replace" ? "Replace with suggested scenes" : "Append suggested scenes"}</button>
        </div>
      </>}
    </Modal>
  );
}

function StoryPreviewPlayer({ svg, story, table, accent, onReady }: {
  svg: string; story: StoryScene[]; table: RenderTargetTable; accent: string; onReady: (ready: boolean) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<StoryboardController | undefined>(undefined);
  const [playback, setPlayback] = useState<StoryPlaybackState>();
  useEffect(() => {
    const root = host.current?.querySelector<SVGSVGElement>("[data-meridian-export]");
    if (!root) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const controller = createStoryboardPlayer(root, { version: 2, scenes: story, loop: false },
      { targetTable: table, accent, reducedMotion: motion.matches, initialPreview: 0, onUpdate: setPlayback });
    if (!controller) return;
    player.current = controller;
    onReady(true);
    const update = () => controller.setReducedMotion(motion.matches);
    motion.addEventListener("change", update);
    return () => { motion.removeEventListener("change", update); controller.destroy(); player.current = undefined; };
  }, [svg, story, table, accent, onReady]);
  return (
    <div className="migration-preview story-suggestion-preview">
      <div ref={host} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="recovery-actions">
        {story.map((scene, index) => <button key={scene.id} className="button quiet" aria-pressed={playback?.sceneIndex === index}
          onClick={() => player.current?.preview(index)}>Preview {scene.title}</button>)}
        <button className="button secondary" onClick={() => playback?.playing ? player.current?.pause() : player.current?.play()}>{playback?.playing ? "Pause story" : "Play story"}</button>
      </div>
    </div>
  );
}
