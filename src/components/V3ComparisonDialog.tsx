import { useEffect, useRef, useState } from "react";
import { designRecipeIds, readDesignRecipe, type DesignRecipeId } from "../lib/authoring/design-recipes";
import { layoutAlternativeIds, readLayoutAlternative, type LayoutAlternativeId, type LayoutIntent } from "../lib/authoring/layout-alternatives";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { viewingScale, type FrameGeometry } from "../lib/authoring/readability";
import { buildExportFrame } from "../lib/export";
import type { RenderResult } from "../types";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Choice = DesignRecipeId | LayoutAlternativeId;
type ComparisonMode = "design" | "layout";
type ReadabilityEvidence = { smallest: number | null; measured: number; unknown: number };
type Preview = { proposal: ReadyProposal; changes: { label: string; before: unknown; after: unknown }[]; url: string; width: number; height: number;
  evidence?: { current: ReadabilityEvidence; proposed: ReadabilityEvidence } };

const viewingProfile = { width: 1280, height: 720, padding: 32 };
function labelEvidence(result: RenderResult, frame: FrameGeometry): ReadabilityEvidence {
  const scale = viewingScale(viewingProfile, frame);
  const labels = result.elements?.filter(item => item.capabilities.includes("typography")) ?? [];
  const sizes = labels.flatMap(item => typeof item.appearance?.labelSizeInDiagram === "number" ? [item.appearance.labelSizeInDiagram * scale] : []);
  return { smallest: sizes.length ? Math.min(...sizes) : null, measured: sizes.length, unknown: labels.length - sizes.length };
}

export default function V3ComparisonDialog({ mode, allowDirection, currentUrl, currentSize, editor, onApply, onClose }: {
  mode: ComparisonMode;
  allowDirection: boolean;
  currentUrl: string;
  currentSize: FrameGeometry;
  editor: Editor;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyDesign"]>;
  onClose: () => void;
}) {
  const layout = mode === "layout";
  const [choice, setChoice] = useState<Choice>(layout ? "balanced" : "clear");
  const [direction, setDirection] = useState<LayoutIntent["direction"]>("keep");
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"current" | "proposed">("current");
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  function resetPreview() {
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
      const proposal = layout ? await editor.prepareLayout({ id: choice as LayoutAlternativeId, direction }, work.signal)
        : await editor.prepareDesign(choice as DesignRecipeId, work.signal);
      const layoutCandidate = layout ? editor.readLayoutPreview(proposal) : undefined;
      const candidate = layout ? layoutCandidate : editor.readDesignPreview(proposal);
      if (!candidate) throw new Error("The project changed. Refresh the preview.");
      const { svg, ...geometry } = buildExportFrame(candidate.rendered.result, candidate.document);
      work.signal.throwIfAborted();
      setPreview({ proposal, changes: candidate.changes, ...geometry,
        evidence: layoutCandidate ? { current: labelEvidence(layoutCandidate.current.result, currentSize), proposed: labelEvidence(candidate.rendered.result, geometry) } : undefined,
        url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
      setView("proposed");
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "This option could not be previewed.");
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
      setError(status === "stale" ? "The project changed. Refresh the preview." : "This option could not be applied with Undo.");
    }
  }

  const options = layout ? layoutAlternativeIds.map(readLayoutAlternative) : designRecipeIds.map(readDesignRecipe);
  const title = options.find(option => option.id === choice)!.title;
  function label(value: unknown) { return typeof value === "boolean" ? value ? "On" : "Off" : String(value); }
  function labelSize(evidence: ReadabilityEvidence) {
    return `${evidence.smallest === null ? "No measured labels" : `${evidence.smallest.toFixed(1)} CSS pixels for the smallest measured label`} · ${evidence.measured} measured · ${evidence.unknown} unknown`;
  }
  return (
    <Modal title={layout ? "Compare layouts" : "Explore designs"} wide onClose={onClose}>
      <p>Diagram scope · Element overrides are preserved.</p>
      <div className="recipe-options" role="group" aria-label={layout ? "Layout alternatives" : "Design recipes"}>
        {options.map(option => {
          return <button className="button secondary" key={option.id} aria-pressed={choice === option.id} disabled={busy}
            onClick={() => { if (choice !== option.id) { setChoice(option.id); resetPreview(); } }}>
            <strong>{option.title}</strong><span>{option.description}</span>
          </button>;
        })}
      </div>
      {layout && <div className="heading-form">
        <label>Source direction<select value={direction} disabled={busy || !allowDirection}
          onChange={event => { setDirection(event.target.value as LayoutIntent["direction"]); resetPreview(); }}>
          <option value="keep">Keep current direction</option><option value="LR">Left to right</option><option value="RL">Right to left</option>
          <option value="TB">Top to bottom</option><option value="BT">Bottom to top</option>
        </select></label>
        {!allowDirection && <p className="muted-note">Direction changes are available for flat flowcharts with explicit node declarations.</p>}
      </div>}
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
          <img src={preview.url} alt={`Proposed ${title} ${mode}`} onLoad={() => setPainted(true)} onError={() => setError("The proposed image could not be displayed.")} />
          <figcaption>Proposed frame · {preview.width} × {preview.height}</figcaption>
        </figure>}
      </div>
      {preview && <ul aria-label={layout ? "Layout changes" : "Design changes"}>{preview.changes.map(change =>
        <li key={change.label}>{change.label} · {label(change.before)} → {label(change.after)}</li>)}</ul>}
      {preview?.evidence && <section aria-label="Viewed label sizes">
        <h3>Viewed labels at 1280 × 720 CSS pixels</h3>
        <p>Current · {labelSize(preview.evidence.current)}</p><p>Proposed · {labelSize(preview.evidence.proposed)}</p>
      </section>}
      {busy && <p role="status">Rendering the {title} {mode}…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button secondary" disabled={busy} onClick={() => void prepare()}>Preview {title}</button>
        <button className="button primary" disabled={!preview || !painted || busy} onClick={apply}>Apply {title}</button>
      </div>
    </Modal>
  );
}
