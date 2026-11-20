import { useEffect, useRef, useState } from "react";
import ReadabilityWorker from "../lib/authoring/readability.worker?worker&inline";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import { minimumAdvisoryLabelSize, viewingScale, type FrameGeometry, type ReadabilityFinding, type ReadabilityReport,
  type ReadabilityTarget, type ViewingProfile } from "../lib/authoring/readability";
import Modal from "./Modal";

const presentation: ViewingProfile = { width: 1280, height: 720, padding: 32 };
const checkNames = { "QC-03": "Viewed label size", "QC-05": "Duplicate names", "QC-06": "Separate regions" } as const;

export default function ReadabilityDialog({ frame, targets, revision, canvas, onClose }: {
  frame: FrameGeometry;
  targets: ReadabilityTarget[];
  revision: number;
  canvas?: ViewingProfile;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"canvas" | "presentation" | "custom">(canvas ? "canvas" : "presentation");
  const [custom, setCustom] = useState(presentation);
  const [result, setResult] = useState<ReadabilityReport>();
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<"once" | "narrow">();
  const [error, setError] = useState("");
  const active = useRef<AbortController | undefined>(undefined);
  const profile = mode === "canvas" && canvas ? canvas : mode === "custom" ? custom : presentation;
  const byId = new Map(targets.map(target => [target.id, target]));

  useEffect(() => () => active.current?.abort(), []);

  function reset() { setResult(undefined); setError(""); setRetry(undefined); }

  async function check() {
    if (active.current || retry === "narrow") return;
    const extended = retry === "once";
    const work = new AbortController();
    active.current = work;
    setBusy(true);
    setError("");
    try {
      viewingScale(profile, frame);
      const report = await runAuthoringWorker<ReadabilityReport>(() => new ReadabilityWorker(), { targets, profile, frame },
        work.signal, "Checking the diagram", extended);
      work.signal.throwIfAborted();
      setResult(report);
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

  function findingText(finding: ReadabilityFinding) {
    if (finding.rule === "QC-03") {
      const name = byId.get(finding.target)?.label || "Unnamed label";
      return <>{name} measures {finding.pixels.toFixed(2)} CSS pixels in this viewing area. Labels under {minimumAdvisoryLabelSize} pixels can be difficult to read.</>;
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
        <p>{profile.width} × {profile.height} CSS pixels · {profile.padding} pixels of padding · Project revision {revision}</p>
        <div className="dialog-actions"><button className="button primary" disabled={busy || retry === "narrow"} onClick={() => void check()}>
          {retry === "once" ? "Retry for five seconds" : "Check diagram"}
        </button></div>
      </div>
      {busy && <p role="status">Checking the current diagram…</p>}
      {error && <p role="alert">{error}</p>}
      {result && <section aria-label="Readability results" aria-busy={busy}>
        <h3>Coverage</h3>
        <ul>{result.coverage.map(item => <li key={item.rule}>{checkNames[item.rule]} · {item.measured} measured · {item.unknown} unknown · {item.inapplicable} not applicable</li>)}</ul>
        <h3>Findings</h3>
        <p role="status">{result.findings.length} {result.findings.length === 1 ? "finding" : "findings"} from the checks above.</p>
        <ul>{result.findings.map((finding, index) => <li key={`${finding.rule}-${index}`}>
          <strong>{checkNames[finding.rule]}</strong><p>{findingText(finding)}</p>
        </li>)}</ul>
      </section>}
    </Modal>
  );
}
