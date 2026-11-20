import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import ReadabilityWorker from "../lib/authoring/readability.worker?worker&inline";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import { canonicalDigest, type BaseToken } from "../lib/authoring/base-token";
import type { openStoredProjectEditor } from "../lib/authoring/project-editor";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { minimumAdvisoryLabelSize, normalizedName, viewingScale, type FrameGeometry, type ReadabilityFinding, type ReadabilityReport,
  type ReadabilityTarget, type ViewingProfile } from "../lib/authoring/readability";
import Modal from "./Modal";

const presentation: ViewingProfile = { width: 1280, height: 720, padding: 32 };
const checkNames = { "QC-01": "Solid text contrast", "QC-03": "Viewed label size", "QC-04": "Label containment",
  "QC-05": "Duplicate names", "QC-06": "Separate regions" } as const;
type Editor = Awaited<ReturnType<typeof openStoredProjectEditor>>;
type ContrastPreview = NonNullable<ReturnType<Editor["readContrastPreview"]>>;

export default function ReadabilityDialog({ frame, targets, token, editor, canvas, dismissed, onDismissed, onRename, onApply, onClose }: {
  frame: FrameGeometry;
  targets: ReadabilityTarget[];
  token: BaseToken;
  editor: Editor;
  canvas?: ViewingProfile;
  dismissed: ReadonlySet<string>;
  onDismissed: Dispatch<SetStateAction<ReadonlySet<string>>>;
  onRename?: (elementId: string) => void;
  onApply: (proposal: ReadyProposal) => ReturnType<Editor["applyContrast"]>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"canvas" | "presentation" | "custom">(canvas ? "canvas" : "presentation");
  const [custom, setCustom] = useState(presentation);
  const [result, setResult] = useState<{ report: ReadabilityReport; findings: { finding: ReadabilityFinding; key: string }[] }>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<"once" | "narrow">();
  const [error, setError] = useState("");
  const [fix, setFix] = useState<{ proposal: ReadyProposal; preview: ContrastPreview; url: string }>();
  const [showDismissed, setShowDismissed] = useState(false);
  const summary = useRef<HTMLParagraphElement>(null);
  const [imageReady, setImageReady] = useState(false);
  const active = useRef<AbortController | undefined>(undefined);
  const profile = mode === "canvas" && canvas ? canvas : mode === "custom" ? custom : presentation;
  const byId = new Map(targets.map(target => [target.id, target]));

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => () => { if (fix) URL.revokeObjectURL(fix.url); }, [fix]);

  function reset() { setResult(undefined); setError(""); setRetry(undefined); setFix(undefined); setImageReady(false); }

  async function check() {
    if (active.current || retry === "narrow") return;
    const extended = retry === "once";
    const work = new AbortController();
    active.current = work;
    setBusy(true);
    setError("");
    setFix(undefined);
    try {
      viewingScale(profile, frame);
      const report = await runAuthoringWorker<ReadabilityReport>(() => new ReadabilityWorker(), { targets, profile, frame },
        work.signal, "Checking the diagram", extended);
      const findings = await Promise.all(report.findings.map(async finding => ({
        finding, key: await canonicalDigest("meridian-quality-finding/v1", dismissalEvidence(finding)),
      })));
      work.signal.throwIfAborted();
      setResult({ report, findings });
      setRetry(undefined);
    } catch (reason) {
      if (!work.signal.aborted) {
        if (reason instanceof AuthoringWorkerTimeout) setRetry(extended ? "narrow" : "once");
        setError(extended && reason instanceof AuthoringWorkerTimeout ? "Try a smaller diagram before rechecking."
          : reason instanceof Error ? reason.message : "The diagram could not be checked.");
      }
    } finally {
      active.current = undefined;
      if (!work.signal.aborted) setBusy(false);
    }
  }

  async function previewFix(elementId: string) {
    if (active.current) return;
    const work = new AbortController();
    active.current = work;
    setBusy(true);
    setError("");
    setFix(undefined);
    setImageReady(false);
    try {
      const proposal = await editor.prepareContrast(elementId, profile, token, work.signal);
      const preview = editor.readContrastPreview(proposal);
      if (!preview) throw new Error("The diagram changed. Check readability again.");
      const url = URL.createObjectURL(new Blob([preview.svg], { type: "image/svg+xml" }));
      setFix({ proposal, preview, url });
    } catch (reason) {
      if (!work.signal.aborted) setError(reason instanceof Error ? reason.message : "The contrast change could not be previewed.");
    } finally {
      active.current = undefined;
      if (!work.signal.aborted) setBusy(false);
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

  function dismissalEvidence(finding: ReadabilityFinding) {
    if (finding.rule === "QC-05") {
      return [finding.rule, 1, [...finding.targets].sort(), normalizedName(byId.get(finding.targets[0])?.label ?? "")];
    }
    if (finding.rule === "QC-06") {
      return [finding.rule, 1, finding.regions.map(region => [...region].sort()).sort()];
    }
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
      return <>{name} has a contrast ratio of {Number(finding.ratio.toPrecision(6))} to 1. Aim for at least {finding.threshold} to 1 at this size.</>;
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
    return <>The diagram contains {finding.regions.length} regions with no connection between them.</>;
  }

  return (
    <Modal title="Check readability" wide onClose={onClose}>
      <div className="heading-form">
        <label>Viewing profile<select value={mode} disabled={busy} onChange={event => { setMode(event.target.value as typeof mode); reset(); }}>
          {canvas && <option value="canvas">Canvas at fit</option>}
          <option value="presentation">Presentation</option><option value="custom">Custom viewport</option>
        </select></label>
        {mode === "custom" && (Object.keys(custom) as (keyof ViewingProfile)[]).map(field => (
          <label key={field}>{field === "width" ? "Width" : field === "height" ? "Height" : "Padding"} in CSS pixels
            <input type="number" min={field === "padding" ? 0 : 100} max={8192} step={1} value={Number.isFinite(custom[field]) ? custom[field] : ""} disabled={busy}
              onChange={event => { setCustom({ ...custom, [field]: event.target.valueAsNumber }); reset(); }} /></label>
        ))}
        <p>{profile.width} × {profile.height} CSS pixels · {profile.padding} pixels of padding · Project revision {token.revision}</p>
        <div className="dialog-actions"><button className="button primary" disabled={busy || retry === "narrow"} onClick={() => void check()}>
          {retry === "once" ? "Retry for five seconds" : "Check diagram"}
        </button></div>
      </div>
      {busy && <p role="status">Checking the current diagram…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <section aria-label="Readability results" aria-busy={busy}>
        <h3>Coverage</h3>
        <ul>{result.report.coverage.map(item => <li key={item.rule}>{checkNames[item.rule]} · {item.measured} measured · {item.unknown} unknown · {item.inapplicable} not applicable</li>)}</ul>
        <p>Contrast measurements cover text with a verified solid backdrop. Gradients and unverified overlaps appear as unknown.</p>
        <p>Label containment compares text bounds with square-corner node shapes. It flags spill greater than half a CSS pixel in the selected viewing area.</p>
        <h3>Findings</h3>
        <p ref={summary} tabIndex={-1} role="status">{findings.length - hiddenCount} {findings.length - hiddenCount === 1 ? "finding" : "findings"} from the checks above.
          {hiddenCount ? ` ${hiddenCount} ignored this session.` : ""}</p>
        {hiddenCount > 0 && <label className="check-label"><input type="checkbox" checked={showDismissed}
          onChange={event => setShowDismissed(event.target.checked)} /> Show ignored findings</label>}
        <ul>{findings.filter(item => showDismissed || !dismissed.has(item.key)).map(({ finding, key }) => <li key={key}>
          <strong>{checkNames[finding.rule]}</strong><p>{findingText(finding)}</p>
          {finding.rule === "QC-01" && !dismissed.has(key) && <button type="button" className="button secondary" disabled={busy}
            onClick={() => void previewFix(finding.target)}>Preview text contrast fix for {byId.get(finding.target)?.label || "unnamed label"}</button>}
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
            <p>Regions follow declared connections.</p><ol>{finding.regions.map(region => <li key={region[0]}>
              {region.map(id => byId.get(id)?.label || "Unnamed element").join(", ")}
            </li>)}</ol>
          </details>}
          <button type="button" className="button quiet" disabled={busy} onClick={() => toggleDismissal(key, dismissed.has(key))}>
            {dismissed.has(key) ? "Restore finding" : "Ignore for this session"}
          </button>
        </li>)}</ul>
      </section>}
      {fix && <section aria-label="Proposed contrast fix" className="migration-preview">
        <h3>Text contrast for {fix.preview.label || "unnamed label"}</h3>
        <p>Use {fix.preview.color} text. Contrast changes from {fix.preview.beforeRatio.toFixed(2)}:1 to {fix.preview.afterRatio.toFixed(2)}:1. The target is {fix.preview.threshold}:1.</p>
        <img src={fix.url} alt="Proposed text contrast" onLoad={() => setImageReady(true)}
          onError={() => setError("The proposed diagram could not be displayed.")} />
        <div className="dialog-actions">
          <button type="button" className="button quiet" onClick={() => setFix(undefined)}>Cancel contrast fix</button>
          <button type="button" className="button primary" disabled={!imageReady} onClick={applyFix}>Apply text color</button>
        </div>
      </section>}
    </Modal>
  );
}
