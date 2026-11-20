import { useMemo, useState } from "react";
import {
  Check,
  CircleAlert,
  Code2,
  Download,
  FileCode2,
  FileImage,
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
  exportPresentation,
  pngDimensions,
} from "../lib/export";
import { downloadText, safeFilename } from "../lib/storage";
import Modal from "./Modal";

type Format = "png" | "svg" | "html" | "project" | "source";
const FORMATS = [
  ["png", FileImage, "PNG", "Still image for slides"],
  ["svg", Frame, "SVG", "Scalable vector artwork"],
  ["html", FileCode2, "HTML", "Offline animated presentation"],
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
  notify,
  onClose,
}: {
  document: StudioDocument;
  result: RenderResult | null;
  stale: boolean;
  rendering: boolean;
  renderError: string;
  onRender: () => void;
  onEditSource: () => void;
  onDownload: () => void;
  notify: Notify;
  onClose: () => void;
}) {
  const [format, setFormat] = useState<Format>("png");
  const [scale, setScale] = useState(2);
  const [transparent, setTransparent] = useState(false);
  const [includeFrame, setIncludeFrame] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visual = format === "png" || format === "svg" || format === "html";
  const valid = result !== null && !stale && !renderError;
  const frame = useMemo(
    () =>
      visual && valid && result
        ? buildExportFrame(result, document, {
            transparent,
            includeFrame,
            animated: format === "html",
          })
        : null,
    [visual, valid, result, document, transparent, includeFrame, format],
  );
  const size = frame ? pngDimensions(frame.width, frame.height, scale) : null;
  const filename = safeFilename(document.title);
  const download = async () => {
    setBusy(true);
    setError("");
    try {
      if (format === "project") onDownload();
      else if (format === "source") {
        downloadText(
          document.source,
          `${filename}.mmd`,
          "text/plain;charset=utf-8",
        );
        notify("Mermaid source downloaded.");
      } else if (!frame)
        throw new Error(
          "Render the current diagram successfully before exporting it.",
        );
      else if (format === "svg") {
        downloadSvg(frame.svg, `${filename}.svg`);
        notify("SVG downloaded.");
      } else if (format === "html") {
        await exportPresentation(frame.svg, document);
        notify("Offline HTML presentation downloaded.");
      } else {
        const pixels = await exportPng(frame.svg, `${filename}.png`, scale);
        notify(
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
          <label className="check-label">
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
                      : `${document.storyboard?.scenes.length || 0} scenes · Works offline`}
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
        </fieldset>
      )}
      {visual && !valid && (
        <div className="export-recovery" role="status">
          <CircleAlert size={18} />
          <div>
            <strong>
              {renderError
                ? "Correct the source to export a picture."
                : !document.source.trim()
                  ? "Add a diagram to export a picture."
                  : rendering
                    ? "Rendering your latest changes…"
                    : "Update the canvas before exporting."}
            </strong>
            <p>Project and Mermaid downloads are always available.</p>
            <button
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
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          <CircleAlert size={16} />
          {error}
        </p>
      )}
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
          disabled={busy || (visual && !valid)}
          onClick={download}
        >
          {busy ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Download size={16} />
          )}
          {busy
            ? "Preparing download…"
            : `Download ${format === "project" ? "project" : format === "source" ? "MERMAID" : format.toUpperCase()}`}
        </button>
      </div>
    </Modal>
  );
}
