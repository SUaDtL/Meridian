import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import ReadabilityWorker from "../lib/authoring/readability.worker?worker&inline";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import { canonicalDigest, type BaseToken } from "../lib/authoring/base-token";
import type { ContrastKind } from "../lib/authoring/contrast-fix";
import { styleFieldLabels } from "../lib/authoring/design-reset";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { minimumAdvisoryLabelSize, normalizedName, viewingScale, type FrameGeometry, type ReadabilityFinding, type ReadabilityReport,
  type ReadabilityTarget, type RolePaintField, type ViewingProfile } from "../lib/authoring/readability";
import { routeTolerance } from "../lib/authoring/route-geometry";
import Modal from "./Modal";

const presentation: Required<ViewingProfile> = { width: 1280, height: 720, padding: 32 };
const checkNames = { "QC-01": "Solid text contrast", "QC-02": "Connector contrast", "QC-03": "Viewed label size", "QC-04": "Label containment",
  "QC-05": "Duplicate names", "QC-06": "Separate regions", "QC-07": "Crossing candidates", "QC-08": "Explicit role styling" } as const;
type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type ContrastPreview = NonNullable<ReturnType<Editor["readContrastPreview"]>>;
export type ReadabilityProfileChoice = { mode: "canvas" | "presentation" | "document" | "custom";
  custom: Required<ViewingProfile>; documentWidth: number };
export const initialReadabilityProfile = (canvas?: ViewingProfile): ReadabilityProfileChoice => ({
  mode: canvas ? "canvas" : "presentation", custom: presentation, documentWidth: 720,
});

export default function ReadabilityDialog({ frame, targets, token, editor, canvas, viewing, onViewing, dismissed, onDismissed, onRename, onResetRolePaint,
  onCompareLayouts, highlightTargets, onApply, onClose }: {
  frame: FrameGeometry;
  targets: ReadabilityTarget[];
  token: BaseToken;
  editor: Editor;
  canvas?: ViewingProfile;
  viewing: ReadabilityProfileChoice;
  onViewing: (choice: ReadabilityProfileChoice) => void;
  dismissed: ReadonlySet<string>;
  onDismissed: Dispatch<SetStateAction<ReadonlySet<string>>>;
  onRename?: (elementId: string) => void;
  onResetRolePaint?: (elementId: string, field: RolePaintField) => void;
  onCompareLayouts?: () => void;
  highlightTargets: (ids: readonly string[]) => string;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyContrast"]>;
  onClose: () => void;
}) {
  const { custom, documentWidth } = viewing;
  const mode = viewing.mode === "canvas" && !canvas ? "presentation" : viewing.mode;
  const [result, setResult] = useState<{ report: ReadabilityReport; findings: { finding: ReadabilityFinding; key: string }[] }>();
  const [phase, setPhase] = useState<"check" | "findings" | "contrast">();
  const busy = phase !== undefined;
  const [cancelled, setCancelled] = useState(false);
  const [retry, setRetry] = useState<"once" | "narrow">();
  const [error, setError] = useState("");
  const [fix, setFix] = useState<{ proposal: ReadyProposal; preview: ContrastPreview; url: string }>();
  const [showDismissed, setShowDismissed] = useState(false);
  const [highlight, setHighlight] = useState<{ url: string; ids: readonly string[]; label: string }>();
  const [highlightError, setHighlightError] = useState(false);
  const summary = useRef<HTMLParagraphElement>(null);
  const checkButton = useRef<HTMLButtonElement>(null);
  const [imageReady, setImageReady] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const profile: ViewingProfile = mode === "canvas" && canvas ? canvas
    : mode === "document" ? { width: documentWidth, padding: 0 }
    : mode === "custom" ? custom : presentation;
  const byId = new Map(targets.map(target => [target.id, target]));

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => () => { if (fix) URL.revokeObjectURL(fix.url); }, [fix]);
  useEffect(() => () => { if (highlight) URL.revokeObjectURL(highlight.url); }, [highlight]);

  function reset() { setResult(undefined); setError(""); setRetry(undefined); setFix(undefined); setImageReady(false); setCancelled(false); }

  function changeViewing(change: Partial<ReadabilityProfileChoice>) {
    onViewing({ ...viewing, ...change });
    reset();
  }

  function cancel() {
    const work = active.current;
    if (!work) return;
    active.current = undefined;
    work.abort();
    setPhase(undefined);
    setCancelled(true);
    requestAnimationFrame(() => checkButton.current?.focus());
  }

  async function check() {
    if (active.current || retry === "narrow") return;
    const extended = retry === "once";
    setResult(undefined);
    const work = new AbortController();
    active.current = work;
    setPhase("check");
    setCancelled(false);
    setError("");
    setFix(undefined);
    try {
      viewingScale(profile, frame);
      const report = await runAuthoringWorker<ReadabilityReport>(() => new ReadabilityWorker(), { targets, profile, frame },
        work.signal, "Checking the diagram", extended);
      work.signal.throwIfAborted();
      setPhase("findings");
      const findings = await Promise.all(report.findings.map(async finding => ({
        finding, key: await canonicalDigest("meridian-quality-finding/v1", dismissalEvidence(finding)),
      })));
      work.signal.throwIfAborted();
      setResult({ report, findings });
      setRetry(undefined);
    } catch (reason) {
      if (!work.signal.aborted) {
        if (reason instanceof AuthoringWorkerTimeout) setRetry(extended ? "narrow" : "once");
        setError(extended && reason instanceof AuthoringWorkerTimeout ? "Not fully measured. The retry timed out. Try a smaller diagram before rechecking."
          : reason instanceof AuthoringWorkerTimeout ? "Not fully measured. " + reason.message
          : reason instanceof Error ? reason.message : "The diagram could not be checked.");
      }
    } finally {
      if (active.current === work) {
        active.current = undefined;
        if (!work.signal.aborted) setPhase(undefined);
      }
    }
  }

  async function previewFix(elementId: string, kind: ContrastKind) {
    if (active.current) return;
    const work = new AbortController();
    active.current = work;
    setPhase("contrast");
    setCancelled(false);
    setError("");
    setFix(undefined);
    setImageReady(false);
    try {
      const proposal = await editor.prepareContrast(elementId, profile, token, kind, work.signal);
      work.signal.throwIfAborted();
      const preview = editor.readContrastPreview(proposal);
      if (!preview) throw new Error("The diagram changed. Check readability again.");
      const url = URL.createObjectURL(new Blob([preview.svg], { type: "image/svg+xml" }));
      setFix({ proposal, preview, url });
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "The contrast change could not be previewed.");
    } finally {
      if (active.current === work) {
        active.current = undefined;
        if (!work.signal.aborted) setPhase(undefined);
      }
    }
  }

  function applyFix() {
    if (!fix || !imageReady) return;
    const status = onApply(fix.proposal);
    if (status === "applied") onClose();
    else {
      setFix(undefined);
      setError(status === "stale" ? "The diagram changed. Check readability again." : "The contrast change could not be applied with Undo.");
    }
  }

  function showTargets(ids: readonly string[], label: string) {
    setError("");
    setHighlightError(false);
    try {
      const svg = highlightTargets(ids);
      setHighlight({ ids, label, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The reviewed targets could not be shown.");
    }
  }

  function dismissalEvidence(finding: ReadabilityFinding) {
    if (finding.rule === "QC-05") {
      return [finding.rule, 1, [...finding.targets].sort(), normalizedName(byId.get(finding.targets[0])?.label ?? "")];
    }
    if (finding.rule === "QC-06") {
      return [finding.rule, 1, finding.regions.map(region => [...region].sort()).sort()];
    }
    if (finding.rule === "QC-08") return [1, finding];
    if (finding.rule === "QC-01") return [1, finding, byId.get(finding.target)?.solidTextPaint ?? null, profile];
    if (finding.rule === "QC-02") return [1, finding, byId.get(finding.target)?.solidConnectorPaint ?? null];
    return [1, finding, profile];
  }

  const findings = result?.findings ?? [];
  const hiddenCount = findings.filter(item => dismissed.has(item.key)).length;

  function toggleDismissal(key: string, restore: boolean) {
    onDismissed(current => {
      const next = new Set(current);
      if (restore) next.delete(key);
      else {
        next.add(key);
        if (next.size > 2_000) next.delete(next.values().next().value!);
      }
      return next;
    });
    requestAnimationFrame(() => summary.current?.focus());
  }

  function findingText(finding: ReadabilityFinding) {
    if (finding.rule === "QC-01") {
      const name = byId.get(finding.target)?.label || "Unnamed label";
      return <>{name} has a contrast ratio of {finding.ratio} to 1. Aim for at least {finding.threshold} to 1 at this size.</>;
    }
    if (finding.rule === "QC-02") {
      const name = byId.get(finding.target)?.label || "Unnamed connection";
      return <>{name} measures {finding.ratio} to 1 at the center of its stroke. Aim for at least {finding.threshold} to 1.</>;
    }
    if (finding.rule === "QC-03") {
      const name = byId.get(finding.target)?.label || "Unnamed label";
      return <>{name} measures {finding.pixels.toFixed(2)} CSS pixels in this viewing area. Labels under {minimumAdvisoryLabelSize} pixels can be difficult to read.</>;
    }
    if (finding.rule === "QC-04") {
      const name = byId.get(finding.target)?.label || "Unnamed label";
      const sourceId = byId.get(finding.target)?.sourceId;
      return <>{name}{sourceId && <> ({sourceId})</>} extends {finding.pixels.toFixed(2)} CSS pixels beyond its rectangular shape in this viewing area.</>;
    }
    if (finding.rule === "QC-05") {
      const name = byId.get(finding.targets[0])?.label || "Unnamed element";
      return <>{finding.targets.length} distinct elements share the name {name}. Consider making their labels easier to tell apart.</>;
    }
    if (finding.rule === "QC-07") {
      const [a, b] = finding.targets.map(id => byId.get(id)?.label || "Unnamed connection");
      return <>{a} and {b} cross approximately {finding.count === 1 ? "once" : `${finding.count} times`} within the measured routes.</>;
    }
    if (finding.rule === "QC-08") {
      const name = byId.get(finding.target)?.label || "Unnamed node";
      return <>{name} has the {finding.role} role. {styleFieldLabels[finding.field]} renders as {finding.actual}.
        {" "}The saved recipe specifies {finding.expected}.{finding.override && ` User override ${finding.override}.`}</>;
    }
    return <>The diagram contains {finding.regions.length} regions with no connection between them.</>;
  }

  const connectorFix = fix?.preview.kind === "connector";
  return (
    <><Modal title="Check readability" wide onClose={onClose}>
      <div className="heading-form">
        <label>Viewing profile<select value={mode} disabled={busy} onChange={event => changeViewing({ mode: event.target.value as typeof mode })}>
          {canvas && <option value="canvas">Canvas at fit</option>}
          <option value="presentation">Presentation</option><option value="document">Document width</option><option value="custom">Custom viewport</option>
        </select></label>
        {mode === "document" && <label>Allocated width in CSS pixels
          <input type="number" min={100} max={8192} step={1} disabled={busy} value={Number.isFinite(documentWidth) ? documentWidth : ""}
            onChange={event => changeViewing({ documentWidth: event.target.valueAsNumber })} />
        </label>}
        {mode === "custom" && (Object.keys(custom) as (keyof ViewingProfile)[]).map(field => (
          <label key={field}>{field === "width" ? "Width" : field === "height" ? "Height" : "Padding"} in CSS pixels
            <input type="number" min={field === "padding" ? 0 : 100} max={8192} step={1} value={Number.isFinite(custom[field]) ? custom[field] : ""} disabled={busy}
              onChange={event => changeViewing({ custom: { ...custom, [field]: event.target.valueAsNumber } })} /></label>
        ))}
        <p>{profile.height === undefined
          ? `${Number.isFinite(profile.width) ? profile.width : "—"} CSS pixels allocated · Fits width`
          : `${profile.width} × ${profile.height} CSS pixels · ${profile.padding} pixels of padding`} · Project revision {token.revision}</p>
        <div className="dialog-actions"><button ref={checkButton} className="button primary" disabled={busy || retry === "narrow"} onClick={() => void check()}>
          {retry === "once" ? "Retry for five seconds" : "Check diagram"}
        </button>{busy && <button className="button quiet" type="button" onClick={cancel}>
          {phase === "contrast" ? "Cancel contrast preview" : "Cancel check"}
        </button>}</div>
      </div>
      {phase && <p role="status">{phase === "check" ? "Checking the current diagram…"
        : phase === "findings" ? "Preparing findings…" : "Rendering the proposed color…"}</p>}
      {cancelled && <p role="status">Readability work cancelled.</p>}
      {error && <p role="alert">{error}</p>}
      {result && <section aria-label="Readability results" aria-busy={busy}>
        <h3>Readability at this size</h3>
        {Object.entries(checkNames).map(([rule, label]) => {
          const count = findings.filter(item => item.finding.rule === rule && !dismissed.has(item.key)).length;
          if (rule === "QC-03" && count) return <div key={rule}><p><strong>{count} {count === 1 ? "label is" : "labels are"} smaller than 14 px at this output size.</strong></p>
            <button type="button" className="button secondary" disabled={busy} onClick={onCompareLayouts}>Compare orientation and spacing</button></div>;
          return count ? <p key={rule}><strong>{label}</strong> · {count} {count === 1 ? "finding" : "findings"}</p> : null;
        })}
        <details><summary>Measurement coverage</summary>
        <ul>{result.report.coverage.map(item => <li key={item.rule}>{checkNames[item.rule]} · {item.measured} measured · {item.unknown} unknown · {item.inapplicable} not applicable</li>)}</ul>
        <p>Text contrast requires a verified solid backdrop. Gradients and unverified overlaps appear as unknown.</p>
        {!!targets.some(item => item.kind === "edge") && <p>
          Connector contrast samples straight strokes without arrowheads on a verified solid canvas. Thin strokes may still be hard to see.
        </p>}
        <p>Label containment compares text bounds with square-corner node shapes. It flags spill greater than half a CSS pixel in the selected viewing area.</p>
        {!!targets.some(item => item.rolePaint) && <p>Explicit role styling compares measured paint with the saved recipe on nodes with an assigned role.</p>}
        {!!targets.some(item => item.kind === "edge") && <p>
          Crossing candidates count intersections inside route segments with a {routeTolerance} diagram unit approximation.
          {" "}{result.report.crossings.checked.toLocaleString()} segment pairs checked.
          {(result.report.crossings.skipped > 0 || result.report.crossings.routesOverSegmentLimit > 0) && <> Not fully measured.</>}
          {result.report.crossings.routesOverSegmentLimit > 0 && <> {result.report.crossings.routesOverSegmentLimit.toLocaleString()} {result.report.crossings.routesOverSegmentLimit === 1 ? "route" : "routes"} skipped at the segment limit.</>}
          {result.report.crossings.skipped > 0 && <> {result.report.crossings.skipped.toLocaleString()} segment pairs skipped.</>}
          {result.report.crossings.findingsOmitted && <> Additional crossing findings exceed the display limit.</>}
        </p>}
        </details>
        <h3>Findings</h3>
        <p ref={summary} tabIndex={-1} role="status">{findings.length - hiddenCount} {findings.length - hiddenCount === 1 ? "finding" : "findings"} from the checks above.
          {hiddenCount ? ` ${hiddenCount} ignored this session.` : ""}</p>
        {hiddenCount > 0 && <label className="check-label"><input type="checkbox" checked={showDismissed}
          onChange={event => setShowDismissed(event.target.checked)} /> Show ignored findings</label>}
        <ul>{findings.filter(item => showDismissed || !dismissed.has(item.key)).map(({ finding, key }) => <li key={key}>
          <strong>{checkNames[finding.rule]}</strong><p>{findingText(finding)}</p>
          {finding.rule !== "QC-06" && <button type="button" className="button quiet" disabled={busy}
            onClick={() => showTargets("target" in finding ? [finding.target] : finding.targets, checkNames[finding.rule])}>Show in diagram</button>}
          {finding.rule === "QC-01" && !dismissed.has(key) && <button type="button" className="button secondary" disabled={busy}
            onClick={() => void previewFix(finding.target, "text")}>Preview text contrast fix for {byId.get(finding.target)?.label || "unnamed label"}</button>}
          {finding.rule === "QC-02" && !dismissed.has(key) && <button type="button" className="button secondary" disabled={busy}
            onClick={() => void previewFix(finding.target, "connector")}>Preview stroke contrast fix for {byId.get(finding.target)?.label || "unnamed connection"}</button>}
          {finding.rule === "QC-05" && <details><summary>Review elements with this name</summary>
            <ul>{finding.targets.map((id, index) => {
              const item = byId.get(id);
              return <li key={id}>{item?.label || "Unnamed element"} · {item?.kind || "element"} {item?.sourceId || index + 1}
                {item?.kind === "node" && onRename && !dismissed.has(key) && <button type="button" className="button quiet"
                  disabled={busy} onClick={() => onRename(id)}>Edit label {index + 1}</button>}
              </li>;
            })}</ul>
          </details>}
          {finding.rule === "QC-06" && <details><summary>Review regions</summary>
            <p>Regions follow declared connections.</p><ol>{finding.regions.map((region, index) => <li key={region[0]}>
              <span>{region.map(id => byId.get(id)?.label || "Unnamed element").join(", ")}</span>
              <button type="button" className="button quiet" disabled={busy} onClick={() => showTargets(region, `Region ${index + 1}`)}>Show region {index + 1}</button>
            </li>)}</ol>
          </details>}
          {finding.rule === "QC-07" && onCompareLayouts && !dismissed.has(key) && <button type="button" className="button secondary"
            disabled={busy} onClick={onCompareLayouts}>Compare layouts</button>}
          {finding.rule === "QC-08" && onResetRolePaint && !dismissed.has(key)
            && finding.override?.toLowerCase() === finding.actual.toLowerCase() && <button type="button" className="button secondary"
            disabled={busy} onClick={() => onResetRolePaint(finding.target, finding.field)}>Review reset for {byId.get(finding.target)?.label || "unnamed node"}</button>}
          <button type="button" className="button quiet" disabled={busy} onClick={() => toggleDismissal(key, dismissed.has(key))}>
            {dismissed.has(key) ? "Restore finding" : "Ignore for this session"}
          </button>
        </li>)}</ul>
      </section>}
      {fix && <section aria-label="Proposed contrast fix" className="migration-preview">
        <h3>{connectorFix ? "Stroke" : "Text"} contrast for {fix.preview.label || (connectorFix ? "unnamed connection" : "unnamed label")}</h3>
        <p>Use {fix.preview.color} {connectorFix ? "for the stroke" : "text"}. Contrast changes from {fix.preview.beforeRatio.toFixed(2)}:1 to {fix.preview.afterRatio.toFixed(2)}:1. The target is {fix.preview.threshold}:1.</p>
        <img src={fix.url} alt={connectorFix ? "Proposed stroke contrast" : "Proposed text contrast"} onLoad={() => setImageReady(true)}
          onError={() => setError("The proposed diagram could not be displayed.")} />
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => setFix(undefined)}>Cancel contrast fix</button>
          <button type="button" className="button primary" disabled={!imageReady} onClick={applyFix}>{connectorFix ? "Apply stroke color" : "Apply text color"}</button>
        </div>
      </section>}
    </Modal>
    {highlight && <Modal title="Finding on the diagram" wide onClose={() => setHighlight(undefined)} initialFocus="[data-finding-title]">
      <h3 data-finding-title tabIndex={-1}>{highlight.label}</h3>
      <div className="migration-preview">
        <img src={highlight.url} alt="Diagram with highlighted elements" onError={() => setHighlightError(true)} />
      </div>
      {highlightError && <p role="alert">The diagram preview could not be displayed.</p>}
      <details open={highlight.ids.length <= 6}>
        <summary>{highlight.ids.length} highlighted {highlight.ids.length === 1 ? "element" : "elements"}</summary>
        <ul>{highlight.ids.map(id => {
          const target = byId.get(id);
          return <li key={id}>{target?.label || "Unnamed element"}{target?.sourceId && ` (${target.sourceId})`}</li>;
        })}</ul>
      </details>
      <div className="dialog-actions">
        <button type="button" className="button primary" onClick={() => setHighlight(undefined)}>Return to checks</button>
      </div>
    </Modal>}</>
  );
}
