import { useEffect, useRef, useState } from "react";
import { runAuthoringWorker } from "../lib/authoring/authoring-worker";
import type { CrossingSummary, LayoutCrossingComparison } from "../lib/authoring/crossing-findings";
import { designRecipeIds, readDesignRecipe, type DesignRecipeId, type DesignScope } from "../lib/authoring/design-recipes";
import { layoutAlternativeIds, readLayoutAlternative, type LayoutAlternativeId, type LayoutIntent } from "../lib/authoring/layout-alternatives";
import CrossingWorker from "../lib/authoring/layout-crossings.worker?worker&inline";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { SemanticRole } from "../lib/authoring/mermaid-project";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { viewingScale, type FrameGeometry } from "../lib/authoring/readability";
import { buildExportFrame } from "../lib/export";
import type { RenderResult } from "../types";
import Modal from "./Modal";

type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type Choice = DesignRecipeId | LayoutAlternativeId;
type ComparisonMode = "design" | "layout";
type ReadabilityEvidence = { smallest: number | null; measured: number; unknown: number };
type ScopeSummary = NonNullable<NonNullable<ReturnType<Editor["readDesignPreview"]>>["scope"]>;
type Preview = { scope?: ScopeSummary; proposal: ReadyProposal; changes: { label: string; before: unknown; after: unknown }[]; url: string; width: number; height: number;
  evidence?: { current: ReadabilityEvidence; proposed: ReadabilityEvidence; crossings?: LayoutCrossingComparison | null } };

const viewingProfile = { width: 1280, height: 720, padding: 32 };
function labelEvidence(result: RenderResult, frame: FrameGeometry): ReadabilityEvidence {
  const scale = viewingScale(viewingProfile, frame);
  const labels = result.elements?.filter(item => item.capabilities.includes("typography")) ?? [];
  const sizes = labels.flatMap(item => typeof item.appearance?.labelSizeInDiagram === "number" ? [item.appearance.labelSizeInDiagram * scale] : []);
  return { smallest: sizes.length ? Math.min(...sizes) : null, measured: sizes.length, unknown: labels.length - sizes.length };
}

function connectionRoutes(result: RenderResult) {
  return result.elements?.filter(item => item.kind === "edge").map(({ key, kind, measuredRoute }) => ({ id: key, kind, measuredRoute })) ?? [];
}

export default function V3ComparisonDialog({ mode, allowDirection, allowScopedDesign, selection, selectedRoleCounts, currentUrl, currentSize, editor, onApply, onClose }: {
  mode: ComparisonMode;
  allowDirection: boolean;
  allowScopedDesign: boolean;
  selection?: { ids: readonly string[]; hidden: number };
  selectedRoleCounts: readonly [SemanticRole, number][];
  currentUrl: string;
  currentSize: FrameGeometry;
  editor: Editor;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyDesign"]>;
  onClose: () => void;
}) {
  const layout = mode === "layout";
  const [scopeKind, setScopeKind] = useState<DesignScope["kind"]>(selection?.ids.length ? "selection" : "diagram");
  const [preserveOverrides, setPreserveOverrides] = useState(true);
  const [enlargeLabels, setEnlargeLabels] = useState(false);
  const [applyRoleShapes, setApplyRoleShapes] = useState(() => editor.snapshot().design.applyRoleShapes);
  const [role, setRole] = useState<SemanticRole | "">(selectedRoleCounts[0]?.[0] ?? "");
  const [choice, setChoice] = useState<Choice>(layout ? "balanced" : "clear");
  const [direction, setDirection] = useState<LayoutIntent["direction"]>("keep");
  const offerRoleShapes = allowScopedDesign && choice === "presentation" && selectedRoleCounts.some(([id]) => id === "decision");
  const offerTypography = allowScopedDesign && scopeKind !== "diagram" && choice === "presentation";
  const [preview, setPreview] = useState<Preview>();
  const [painted, setPainted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelled, setCancelled] = useState(false);
  const [view, setView] = useState<"current" | "proposed">("current");
  const active = useRef<AbortController | undefined>(undefined);
  const previewButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => {
    const work = active.current;
    active.current = undefined;
    work?.abort();
  }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  function resetPreview() {
    setPreview(undefined);
    setPainted(false);
    setView("current");
    setError("");
    setCancelled(false);
  }

  function cancelPreview() {
    const work = active.current;
    if (!work) return;
    active.current = undefined;
    work.abort();
    setBusy(false);
    setCancelled(true);
    requestAnimationFrame(() => { if (!active.current) previewButton.current?.focus(); });
  }

  async function prepare() {
    if (active.current || (!layout && scopeKind === "role" && !role)) return;
    const scope: DesignScope = scopeKind === "selection" ? { kind: scopeKind, ids: selection?.ids ?? [], preserveOverrides, enlargeLabels: offerTypography && enlargeLabels }
      : scopeKind === "role" && role ? { kind: scopeKind, role, preserveOverrides, enlargeLabels: offerTypography && enlargeLabels }
        : { kind: "diagram", applyRoleShapes: offerRoleShapes && applyRoleShapes };
    const work = new AbortController();
    active.current = work;
    setBusy(true);
    setPainted(false);
    setError("");
    setCancelled(false);
    setPreview(undefined);
    setView("current");
    try {
      // Give the pending controls a paint opportunity before Mermaid work.
      await new Promise<void>(resolve => requestAnimationFrame(() => window.setTimeout(resolve, 0)));
      work.signal.throwIfAborted();
      const proposal = layout ? await editor.prepareLayout({ id: choice as LayoutAlternativeId, direction }, work.signal)
        : await editor.prepareDesign(choice as DesignRecipeId, scope, work.signal);
      const layoutCandidate = layout ? editor.readLayoutPreview(proposal) : undefined;
      const designCandidate = layout ? undefined : editor.readDesignPreview(proposal);
      const candidate = layoutCandidate ?? designCandidate;
      if (!candidate) throw new Error("The project changed. Refresh the preview.");
      const { svg, ...geometry } = buildExportFrame(candidate.rendered.result, candidate.document);
      let crossings: LayoutCrossingComparison | null | undefined;
      if (layoutCandidate) {
        const current = connectionRoutes(layoutCandidate.current.result);
        const proposed = connectionRoutes(layoutCandidate.rendered.result);
        if (current.length || proposed.length) {
          try {
            crossings = await runAuthoringWorker<LayoutCrossingComparison>(() => new CrossingWorker(), { current, proposed },
              work.signal, "Comparing measured routes", false);
          } catch {
            work.signal.throwIfAborted();
            crossings = null;
          }
        }
      }
      work.signal.throwIfAborted();
      setPreview({ proposal, changes: candidate.changes, ...geometry, scope: designCandidate?.scope,
        evidence: layoutCandidate ? { current: labelEvidence(layoutCandidate.current.result, currentSize),
          proposed: labelEvidence(candidate.rendered.result, geometry), crossings } : undefined,
        url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
      setView("proposed");
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "This option could not be previewed.");
    } finally {
      if (active.current === work) {
        active.current = undefined;
        setBusy(false);
      }
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
  function routeSummary(summary: CrossingSummary) {
    return `${summary.count} crossing ${summary.count === 1 ? "candidate" : "candidates"} in checked routes · ${summary.measured} measured · ${summary.unknown} unknown · ${summary.checked.toLocaleString()} pairs checked`
      + (summary.skipped ? ` · ${summary.skipped.toLocaleString()} pairs skipped` : "");
  }
  function crossingComparison({ current, proposed, crossings }: NonNullable<Preview["evidence"]>) {
    if (!crossings) return null;
    const complete = [crossings.current, crossings.proposed].every(item => item.measured > 0 && !item.unknown && !item.skipped);
    if (!complete || crossings.current.measured !== crossings.proposed.measured) {
      return "Crossing coverage is incomplete for this comparison.";
    }
    if (crossings.current.count === crossings.proposed.count) return "The checked routes have the same crossing candidate count.";
    if (crossings.proposed.count < crossings.current.count && current.smallest !== null && proposed.smallest !== null
      && !current.unknown && !proposed.unknown && current.measured === proposed.measured
      && Number(proposed.smallest.toFixed(1)) < Number(current.smallest.toFixed(1))) {
      return `The proposed layout has fewer crossing candidates. Its smallest viewed label drops from ${current.smallest.toFixed(1)} to ${proposed.smallest.toFixed(1)} CSS pixels.`;
    }
    return null;
  }
  const comparisonNote = preview?.evidence && crossingComparison(preview.evidence);
  return (
    <Modal title={layout ? "Compare layouts" : "Explore designs"} wide onClose={onClose}>
      {!layout && <div className="heading-form">
        <label>Design scope<select value={scopeKind} disabled={busy} onChange={event => {
          setScopeKind(event.target.value as DesignScope["kind"]);
          resetPreview();
        }}>
          <option value="diagram">Entire diagram</option>
          {allowScopedDesign && !!selection?.ids.length && <option value="selection">Selected elements</option>}
          {allowScopedDesign && selectedRoleCounts.length > 0 && <option value="role">Selected role</option>}
        </select></label>
        {scopeKind === "diagram" && offerRoleShapes && <>
          <label className="check-label">
            <input type="checkbox" checked={applyRoleShapes} disabled={busy} onChange={event => {
              setApplyRoleShapes(event.target.checked);
              resetPreview();
            }} />
            Use diamonds for Decision nodes
          </label>
          {applyRoleShapes && <p>Project and presentation downloads keep the reviewed shapes. Mermaid source keeps its original notation. Explicit shape overrides take precedence.</p>}
        </>}
        {scopeKind === "selection" && selection && <p>{selection.ids.length} selected · {selection.hidden} hidden in the outline</p>}
        {scopeKind === "role" && <label>Role<select value={role} disabled={busy} onChange={event => {
          setRole(event.target.value as SemanticRole);
          resetPreview();
        }}>
          {selectedRoleCounts.map(([option, count]) => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)} ({count})</option>)}
        </select></label>}
        {scopeKind !== "diagram" && <label className="check-label">
          <input type="checkbox" checked={preserveOverrides} disabled={busy} onChange={event => {
            setPreserveOverrides(event.target.checked);
            resetPreview();
          }} /> Preserve my element overrides
        </label>}
        {offerTypography && <>
          <label className="check-label"><input type="checkbox" checked={enlargeLabels} disabled={busy} onChange={event => {
            setEnlargeLabels(event.target.checked);
            resetPreview();
          }} /> Enlarge eligible node labels</label>
          {enlargeLabels && <p>Larger labels may move other nodes during automatic layout. Existing user font sizes are preserved.</p>}
        </>}
        {!allowScopedDesign && <p>Scoped recipes are available on flowcharts with explicit node declarations.</p>}
      </div>}
      <p>{layout || scopeKind === "diagram" ? "Diagram scope · Element overrides are preserved."
        : preserveOverrides ? offerTypography && enlargeLabels ? "This scope uses node paint and eligible label sizes." : "This scope uses node paint."
          : "The preview lists the node paint overrides this recipe will clear."}</p>
      <div className="recipe-options" role="group" aria-label={layout ? "Layout alternatives" : "Design recipes"}>
        {options.map(option => {
          return <button className="button secondary" key={option.id} aria-pressed={choice === option.id} disabled={busy}
            onClick={() => { if (choice !== option.id) { setChoice(option.id); resetPreview(); } }}>
            <strong>{option.title}</strong><span>{!layout && scopeKind !== "diagram" && "nodeStyle" in option
              ? `Fill ${option.nodeStyle.fill} · Text ${option.nodeStyle.color} · Border ${option.nodeStyle.stroke}` : option.description}</span>
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
      {preview?.scope && <section aria-label="Reviewed design scope">
        <p>Applies to {preview.scope.eligible} of {preview.scope.total} elements. {preview.scope.protectedFields} protected paint {preview.scope.protectedFields === 1 ? "field" : "fields"}.</p>
        {preview.scope.clearedFields > 0 && <p>Clears {preview.scope.clearedFields} user paint {preview.scope.clearedFields === 1 ? "override" : "overrides"} from {preview.scope.clearedTargets} {preview.scope.clearedTargets === 1 ? "element" : "elements"}.</p>}
        <p>Diagram-wide settings outside this scope include {preview.scope.omitted.join(", ").toLowerCase()}.</p>
        {preview.scope.typography && <>
          <p>Automatic layout moved {preview.scope.typography.moved.length} {preview.scope.typography.moved.length === 1 ? "node" : "nodes"} outside this scope. Their styling is unchanged.</p>
          {preview.scope.typography.moved.length > 0 && <details><summary>Review moved nodes</summary>
            <ul>{preview.scope.typography.moved.map(name => <li key={name}>{name}</li>)}</ul>
          </details>}
          {preview.scope.typography.protected.length > 0 && <details><summary>Review preserved font sizes</summary>
            <ul>{preview.scope.typography.protected.map(name => <li key={name}>{name}</li>)}</ul>
          </details>}
        </>}
        {preview.scope.exclusions.length > 0 && <details><summary>Review excluded elements</summary>
          <ul>{preview.scope.exclusions.map((label, index) => <li key={index}>{label}</li>)}</ul>
        </details>}
      </section>}
      {preview && <ul aria-label={layout ? "Layout changes" : "Design changes"}>{preview.changes.map(change =>
        <li key={change.label}>{change.label} · {label(change.before)} → {label(change.after)}</li>)}</ul>}
      {preview?.evidence && <section aria-label="Viewed label sizes">
        <h3>Viewed labels at 1280 × 720 CSS pixels</h3>
        <p>Current · {labelSize(preview.evidence.current)}</p><p>Proposed · {labelSize(preview.evidence.proposed)}</p>
      </section>}
      {preview?.evidence?.crossings !== undefined && <section aria-label="Connection crossings">
        <h3>Connection crossing candidates</h3>
        {preview.evidence.crossings ? <>
          <p>Current · {routeSummary(preview.evidence.crossings.current)}</p>
          <p>Proposed · {routeSummary(preview.evidence.crossings.proposed)}</p>
          {comparisonNote && <p>{comparisonNote}</p>}
        </> : <p>The route comparison did not produce measurements.</p>}
      </section>}
      {busy && <p role="status">Rendering the {title} {mode}…</p>}
      {cancelled && <p role="status">Preview cancelled. Your choices are ready to preview again.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        {busy && <button className="button quiet" onClick={cancelPreview}>Cancel preview</button>}
        <button ref={previewButton} className="button secondary" disabled={busy} onClick={() => void prepare()}>Preview {title}</button>
        <button className="button primary" disabled={!preview || !painted || busy} onClick={apply}>Apply {title}</button>
      </div>
    </Modal>
  );
}
