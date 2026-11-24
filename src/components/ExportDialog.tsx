import { useEffect, useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Code2,
  Download,
  FileCode2,
  FileImage,
  FileText,
  Presentation,
  FileJson,
  Frame,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { RenderResult, StudioDocument } from "../types";
import type { Notify } from "../App";
import {
  buildExportFrame,
  downloadSvg,
  exportPng,
  pngDimensions,
  type ExportFrameOptions,
} from "../lib/export";
import { downloadText, safeFilename } from "../lib/storage";
import { downloadBlob } from "../lib/download";
import { getTheme } from "../lib/themes";
import { sceneSnapshot } from "../lib/scene-snapshot";
import type { StoryScene } from "../types/storyboard";
import type { RenderTargetTable } from "../lib/authoring/project-render";
import type { BriefingFormat, BriefingPage } from "../lib/briefing-export";
import Modal from "./Modal";

type Format = BriefingFormat | "png" | "svg" | "html" | "project" | "source";
const FORMATS = [
  ["png", FileImage, "PNG", "Still image for slides"],
  ["svg", Frame, "SVG", "Scalable vector artwork"],
  ["html", FileCode2, "HTML", "Offline animated presentation"],
  ["pdf", FileText, "PDF", "Widescreen document"],
  ["pptx", Presentation, "PowerPoint", "Widescreen slide deck"],
  ["project", FileJson, "Project", "Editable source, style + scenes"],
  ["source", Code2, "Mermaid", "Plain .mmd source"],
] as const;

export default function ExportDialog({
  document,
  result,
  stale,
  rendering,
  renderError,
  onRender,
  onEditSource,
  onDownload,
  presentation,
  notify,
  onClose,
}: {
  document: Pick<StudioDocument, "title" | "subtitle" | "source" | "settings">;
  result: RenderResult | null;
  stale: boolean;
  rendering: boolean;
  renderError: string;
  onRender?: () => void;
  onEditSource: () => void;
  onDownload: () => void;
  presentation: {
    scenes?: StoryScene[];
    targets?: RenderTargetTable | null;
    download: (svg: string, options: ExportFrameOptions) => Promise<void>;
    unavailable?: string;
  };
  notify?: Notify;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<Format>("png");
  const [target, setTarget] = useState<NonNullable<ExportFrameOptions["target"]>>("current");
  const [previewUrl, setPreviewUrl] = useState("");
  const [scope, setScope] = useState<"diagram" | "scenes">("diagram");
  const [pageIndex, setPageIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [previewError, setPreviewError] = useState("");
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [includeFrame, setIncludeFrame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const report = notify ?? setSuccess;
  const briefing = format === "pdf" || format === "pptx";
  const scenePages = briefing && scope === "scenes" && !!presentation.scenes?.length;
  const visual = briefing || format === "png" || format === "svg" || format === "html";
  const sourceIssue = /[\uD800-\uDFFF]/u.test(document.source)
    ? "This source contains an unmatched Unicode surrogate. Download the project to preserve it exactly."
    : "";
  const valid = result !== null && !stale && !renderError && !(format === "html" && presentation.unavailable);
  const frame = useMemo(
    () =>
      visual && valid && result
        ? buildExportFrame(result, document, {
            target: briefing ? "slide" : target, transparent: briefing ? false : transparent,
            includeFrame: briefing || includeFrame,
            animated: format === "html",
          })
        : null,
    [visual, valid, result, document, transparent, includeFrame, format, target],
  );
  const size = frame ? pngDimensions(frame.width, frame.height, scale) : null;
  const pages = useMemo<BriefingPage[]>(() => {
    if (!frame || !briefing) return [];
    if (!scenePages) return [{ title: document.title, svg: () => frame.svg }];
    const template = new DOMParser().parseFromString(frame.svg, "image/svg+xml").documentElement as unknown as SVGSVGElement;
    return presentation.scenes!.map(scene => ({ title: scene.title, svg: () => sceneSnapshot(template, scene, presentation.targets) }));
  }, [frame, briefing, scenePages, presentation.scenes, presentation.targets, document.title]);
  const currentPage = Math.min(pageIndex, Math.max(0, pages.length - 1));
  useEffect(() => {
    setPreviewError("");
    if (!frame) { setPreviewUrl(""); return; }
    let svg: string;
    try { svg = pages[currentPage]?.svg() ?? frame.svg; }
    catch { setPreviewUrl(""); setPreviewError("The selected scene could not be prepared. Try exporting the full diagram."); return; }
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [frame, pages, currentPage]);
  const viewingScale = frame && target === "slide" ? Math.min(1280 / frame.width, 720 / frame.height)
    : frame && target === "figure" ? 640 / frame.width : 1;
  const sizes = (result?.elements ?? []).flatMap(element => element.appearance?.labelSizeInDiagram ? [element.appearance.labelSizeInDiagram] : []);
  const smallest = frame && sizes.length ? Math.min(...sizes) * frame.diagramScale * viewingScale : null;
  const occupancy = frame && result ? Math.min(result.width * frame.diagramScale / frame.width, result.height * frame.diagramScale / frame.height) : 1;
  const filename = safeFilename(document.title);
  const download = async () => {
    setBusy(true);
    setProgress(0);
    setError("");
    setSuccess("");
    try {
      if (format === "project") onDownload();
      else if (format === "source") {
        if (sourceIssue) throw new Error(sourceIssue);
        downloadText(
          document.source,
          `${filename}.mmd`,
          "text/plain;charset=utf-8",
        );
        report("Mermaid source downloaded.");
      } else if (!frame)
        throw new Error(
          "Render the current diagram successfully before exporting it.",
        );
      else if (format === "pdf" || format === "pptx") {
        const { briefingFile } = await import("../lib/briefing-export");
        const file = await briefingFile(format, document.title, pages, getTheme(document.settings.theme).canvas, setProgress);
        downloadBlob(file, filename + "." + format);
        report(`${format === "pdf" ? "PDF" : "PowerPoint deck"} downloaded.`);
      } else if (format === "svg") {
        downloadSvg(frame.svg, `${filename}.svg`);
        report("SVG downloaded.");
      } else if (format === "html") {
        await presentation.download(frame.svg, { target, transparent, includeFrame });
        report("Offline HTML presentation downloaded.");
      } else {
        const pixels = await exportPng(frame.svg, `${filename}.png`, scale);
        report(
          `PNG downloaded at ${pixels.width.toLocaleString()} × ${pixels.height.toLocaleString()} pixels.`,
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Export could not finish. Try SVG or a lower PNG resolution.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Take your diagram with you."
      eyebrow="EXPORT"
      onClose={onClose}
      busy={busy}
    >
      <div className="export-format-grid">
        {FORMATS.map(([value, Icon, label, description]) => (
          <button
            key={value}
            disabled={busy}
            className={`export-format ${format === value ? "selected" : ""}`}
            onClick={() => {
              setFormat(value);
              setError("");
              setSuccess("");
            }}
            aria-pressed={format === value}
          >
            <Icon size={22} />
            <span>
              <strong>{label}</strong>
              <small>{description}</small>
            </span>
            {format === value && <Check size={17} />}
          </button>
        ))}
      </div>
      {visual && (
        <fieldset className="export-options" disabled={busy}>
          {briefing && <>
            <label>Pages<select value={scenePages ? "scenes" : "diagram"} onChange={e => { setScope(e.target.value as typeof scope); setPageIndex(0); }}>
              <option value="diagram">Full diagram · 1 page</option>
              {!!presentation.scenes?.length && !presentation.unavailable && <option value="scenes">One page per scene · {presentation.scenes.length} pages</option>}
            </select></label>
            {scenePages && <label>Preview scene<select value={currentPage} onChange={e => setPageIndex(Number(e.target.value))}>
              {pages.map((page, i) => <option key={i} value={i}>{i + 1}. {page.title}</option>)}
            </select></label>}
            <p>16:9 widescreen · 1920 × 1080 artwork per page. {format === "pdf" ? "The PDF contains fixed page images." : "Each slide contains one movable picture."} Mermaid project files preserve editable objects. Private presenter notes stay out of the download.</p>
          </>}
          {!briefing && <label>Output target<select value={target} onChange={event => { setTarget(event.target.value as typeof target); setIncludeFrame(true); }}>
            <option value="current">Current frame · native size</option>
            <option value="slide">Widescreen slide · review at 1280 × 720</option>
            <option value="figure">Document figure · review at 640 px wide</option>
          </select></label>}
          {previewError && <p role="alert">{previewError}</p>}
          {previewUrl && frame && <figure className="export-proof" style={briefing ? {background: getTheme(document.settings.theme).canvas} : undefined}><img src={previewUrl} alt="Preview of the export frame" /></figure>}
          {frame && !briefing && <p className="muted-note">{smallest === null ? "Label sizes unavailable for this diagram." :
            `Smallest measured label at this viewing size: ${smallest.toFixed(1)} px.`}
            {smallest !== null && smallest < 14 && " Labels may be hard to read. Try a tighter figure, a different orientation, or a focused scene."}
            {occupancy < .45 && " The graph fills less than 45% of one frame dimension. Try the document figure target or turn off the presentation frame."}</p>}
          {format === "png" && (
            <label>
              Resolution
              <select
                value={scale}
                onChange={(event) => setScale(Number(event.target.value))}
              >
                <option value={1}>1× · Standard</option>
                <option value={2}>2× · Crisp</option>
                <option value={4}>4× · Large format</option>
              </select>
            </label>
          )}
          {!briefing && <><label className="check-label">
            <input
              type="checkbox"
              checked={includeFrame}
              onChange={(event) => setIncludeFrame(event.target.checked)}
            />
            <span>
              Include presentation frame
              <small>Heading, spacing, and canvas settings</small>
            </span>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={transparent}
              onChange={(event) => setTransparent(event.target.checked)}
            />
            <span>
              Transparent background
              <small>Keeps your current text and node colors</small>
            </span>
          </label>
          {frame && (
            <div className="export-dimensions">
              {format === "png" && size ? (
                <>
                  <strong>
                    {size.width.toLocaleString()} ×{" "}
                    {size.height.toLocaleString()} px
                  </strong>
                  <span>
                    {((size.width * size.height) / 1_000_000).toFixed(1)}{" "}
                    megapixels
                    {size.width < Math.floor(frame.width * scale) ||
                    size.height < Math.floor(frame.height * scale)
                      ? " · Sized to the browser export limit"
                      : ""}
                  </span>
                </>
              ) : (
                <>
                  <strong>
                    {Math.round(frame.width).toLocaleString()} ×{" "}
                    {Math.round(frame.height).toLocaleString()}
                  </strong>
                  <span>
                    {format === "svg"
                      ? "Vector dimensions; scales without losing detail"
                      : `${(presentation.scenes?.length ?? 0)} scenes · Works offline`}
                  </span>
                </>
              )}
            </div>
          )}
          <p className="muted-note">
            {format === "html"
              ? "One self-contained file with playback controls. Share it with anyone who has a browser."
              : "PNG and SVG are still images. Choose HTML to include animation and presentation scenes."}
          </p>
          </>}
        </fieldset>
      )}
      {visual && !valid && (
        <div className="export-recovery" role="status">
          <CircleAlert size={18} />
          <div>
            <strong>
              {format === "html" && presentation.unavailable
                ? presentation.unavailable
                : renderError
                ? "Correct the source to export a picture."
                : !document.source.trim()
                  ? "Add a diagram to export a picture."
                  : rendering
                    ? "Rendering your latest changes…"
                    : "Update the canvas before exporting."}
            </strong>
            <p>{sourceIssue ? "Download the project to preserve the exact source." : "Project and Mermaid downloads are always available."}</p>
            {(renderError || !document.source.trim() || onRender) && <button
              className="button secondary"
              disabled={rendering}
              onClick={
                renderError || !document.source.trim()
                  ? () => {
                      onClose();
                      onEditSource();
                    }
                  : onRender
              }
            >
              {renderError || !document.source.trim() ? (
                <Code2 size={14} />
              ) : (
                <RefreshCw size={14} />
              )}
              {renderError || !document.source.trim()
                ? "Open source"
                : "Render now"}
            </button>}
          </div>
        </div>
      )}
      {format === "source" && sourceIssue && <p role="status">{sourceIssue}</p>}
      {error && (
        <p className="inline-error" role="alert">
          <CircleAlert size={16} />
          {error}
        </p>
      )}
      {success && <p role="status">{success}</p>}
      <div className="export-bottom">
        <span>
          {filename}.
          {format === "project"
            ? "meridian.json"
            : format === "source"
              ? "mmd"
              : format}
        </span>
        <button
          className="button primary"
          disabled={busy || !!previewError || (visual && !valid) || (format === "source" && !!sourceIssue)}
          onClick={download}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Download size={16} />
          )}
          {busy
            ? (briefing && progress ? `Preparing page ${progress} of ${pages.length}…` : "Preparing download…")
            : `Download ${format === "project" ? "project" : format === "source" ? "MERMAID" : format.toUpperCase()}`}
        </button>
      </div>
    </Modal>
  );
}
