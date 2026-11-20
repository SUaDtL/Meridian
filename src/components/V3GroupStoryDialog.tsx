import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { GroupStoryChoice, GroupStoryOptions } from "../lib/authoring/group-story";
import { resolveStoryPath, type PathStoryOptions, type PathStep } from "../lib/authoring/path-story";
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
type PathDraft = Omit<PathStoryOptions, "animate" | "duration">;
export type GroupStoryDraft = GroupStoryOptions & {
  destination: "append" | "replace"; strategy: "groups" | "path"; path: PathDraft;
};
export const initialGroupStoryDraft: GroupStoryDraft = {
  groups: [], overview: true, ungrouped: false, animate: false, duration: 5, destination: "append",
  strategy: "groups", path: { startId: "", steps: [], includeContext: false, title: "" },
};
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
  const snapshot = editor.snapshot();
  const existing = snapshot.storyboard.scenes;
  const sourceIds = useMemo(() => new Map(snapshot.identity.elements.flatMap(record => record.status === "resolved"
    && record.binding.type !== "legacy-edge" ? [[record.id, record.binding.sourceId]] : [])), [snapshot.identity]);
  const groups = table.targets.filter(target => target.elementKind === "group");
  const canIncludeUngrouped = table.targets.some(target => target.elementKind === "node" && target.parentId === null);
  const total = draft.groups.length + Number(draft.overview) + Number(draft.ungrouped);
  const path = useMemo(() => {
    if (!draft.path.startId) return undefined;
    try { return resolveStoryPath(table, draft.path.startId, draft.path.steps); }
    catch { return undefined; }
  }, [table, draft.path.startId, draft.path.steps]);
  const sceneCount = draft.strategy === "path" ? Number(!!path) : total;
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
    if (!sceneCount || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    setPreviewReady(false);
    try {
      const { destination, strategy, path: selection, ...options } = draft;
      const proposal = await editor.prepareStory(strategy === "groups" ? { strategy, options }
        : { strategy, options: { ...selection, animate: options.animate, duration: options.duration } }, destination, controller.signal);
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
        <label>Scene strategy<select value={draft.strategy} disabled={busy} onChange={event => {
          setError("");
          onDraft(current => ({ ...current, strategy: event.target.value === "path" ? "path" : "groups" }));
        }}>
          <option value="groups">Overview by groups</option><option value="path">Follow a path</option>
        </select></label>
        {draft.strategy === "groups" ? <>
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
        </> : <PathChoices table={table} sourceIds={sourceIds} draft={draft.path} resolved={path} disabled={busy} onChange={change => {
          setError("");
          onDraft(current => ({ ...current, path: { ...current.path, ...change } }));
        }} />}
        <label>Scene duration in seconds<input type="number" min={0.5} max={120} step={0.5} value={Number.isFinite(draft.duration) ? draft.duration : ""} disabled={busy}
          onChange={event => onDraft(current => ({ ...current, duration: event.target.valueAsNumber }))} /></label>
        <label className="check-label"><input type="checkbox" checked={draft.animate} disabled={busy}
          onChange={event => onDraft(current => ({ ...current, animate: event.target.checked }))} /> Animate visible directional connections</label>
        <label>Apply to storyboard<select value={draft.destination} disabled={busy}
          onChange={event => onDraft(current => ({ ...current, destination: event.target.value === "replace" ? "replace" : "append" }))}>
          <option value="append">Append scenes</option><option value="replace">Replace scenes</option>
        </select></label>
        {draft.destination === "replace" && existing.length > 0 && <p>Replace {existing.length} current scenes: {existing.map(scene => scene.title || "Untitled scene").join(", ")}</p>}
        <div className="dialog-actions"><button className="button primary" disabled={busy || sceneCount === 0} onClick={() => void prepare()}>Preview {sceneCount} {sceneCount === 1 ? "scene" : "scenes"}</button></div>
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

function PathChoices({ table, sourceIds, draft, resolved, disabled, onChange }: {
  table: RenderTargetTable;
  sourceIds: ReadonlyMap<string, string>;
  draft: PathDraft;
  resolved: ReturnType<typeof resolveStoryPath> | undefined;
  disabled: boolean;
  onChange: (change: Partial<PathDraft>) => void;
}) {
  const [selection, setSelection] = useState("");
  const next = resolved?.following[Number(selection)];
  const ids = table.targets.filter(target => target.elementKind === "node");
  const label = (id?: string | null) => (id && resolved?.byId.get(id)?.label) || "Unnamed node";
  const relationshipDirection = (edge: ReturnType<typeof resolveStoryPath>["following"][number]["edge"], traversal: PathStep["traversal"]) =>
    edge.direction === "both" ? "Bidirectional" : edge.direction === "none" ? "Undirected"
      : traversal === "forward" ? "Along the arrow" : "Against the arrow";

  return <fieldset className="guided-process-fieldset" disabled={disabled}>
    <legend>Path choices</legend>
    <label>Start node<select value={draft.startId} onChange={event => {
      setSelection("");
      onChange({ startId: event.target.value, steps: [] });
    }}>
      <option value="">Choose a node</option>
      {ids.map(node => <option key={node.id} value={node.id}>{node.label || "Unnamed node"}{sourceIds.has(node.id) && ` (${sourceIds.get(node.id)})`}</option>)}
    </select></label>
    {draft.startId && !resolved && <p role="alert">The diagram no longer matches this path. Choose the start and connections again.</p>}
    {resolved && <>
      <p>Starts at {label(resolved.start.id)}.</p>
      {!!draft.steps.length && <ol aria-label="Chosen connections">
        {draft.steps.map(({ edgeId, traversal }, index) => {
          const edge = resolved.byId.get(edgeId)!;
          const from = traversal === "forward" ? edge.sourceId : edge.targetId;
          const to = traversal === "forward" ? edge.targetId : edge.sourceId;
          return <li key={index}>{label(from)} → {label(to)} · {relationshipDirection(edge, traversal)}{sourceIds.has(edgeId) && ` · ${sourceIds.get(edgeId)}`}</li>;
        })}
      </ol>}
      {resolved.loop && <p role="status">Loop returns to {label(resolved.loop.id)}. The path ends here.</p>}
      {!resolved.loop && !resolved.following.length && <p>The path has no further available connections.</p>}
      {resolved.following.length > 0 && <>
        <label>Next connection from {label(resolved.endpoint.id)}
          <select value={selection} onChange={event => setSelection(event.target.value)}>
            <option value="">Choose a connection</option>
            {resolved.following.map(({ edge, traversal, next }, index) => <option key={`${edge.id}:${traversal}`} value={index}>
              {edge.label || `Connection to ${next.label || "unnamed node"}`} · {relationshipDirection(edge, traversal)} · {sourceIds.get(edge.id) ?? `Choice ${index + 1}`}
            </option>)}
          </select>
        </label>
        <button type="button" className="button secondary" disabled={!selection || !next} onClick={() => {
          if (!next) return;
          setSelection("");
          onChange({ steps: [...draft.steps, { edgeId: next.edge.id, traversal: next.traversal }] });
        }}>Add connection to path</button>
      </>}
      {!!draft.steps.length && <button type="button" className="button quiet" onClick={() => {
        setSelection("");
        onChange({ steps: draft.steps.slice(0, -1) });
      }}>Remove last connection</button>}
    </>}
    <label>Scene title<input maxLength={120} value={draft.title} onChange={event => onChange({ title: event.target.value })} /></label>
    <label className="check-label"><input type="checkbox" checked={draft.includeContext}
      onChange={event => onChange({ includeContext: event.target.checked })} /> Include one-hop context</label>
  </fieldset>;
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
