import { useEffect, useRef, useState, type ChangeEvent } from "react";
import Modal from "./Modal";
import ChartFigure, { describeChart } from "./ChartFigure";
import ChartDataTable, { chartHtml } from "./ChartDataTable";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import Worker from "../lib/authoring/chart-input.worker?worker&inline";
import { chartDataLimits, type ChartDataset, type ChartField, type ChartProject, type ChartSpec, type FieldType } from "../lib/authoring/chart-data";
import type { ChartInput, ChartInputFormat, ColumnConfirmation } from "../lib/authoring/chart-input";
import { parseChartProject, validateChartProject } from "../lib/authoring/chart-project";
import { listChartCheckpoints, saveChartCheckpoint, type ChartCheckpoint } from "../lib/persistence/chart-drafts";
import { discardGuidedCheckpoint } from "../lib/persistence/guided-drafts";
import { listWorkspaceProjectIds, openWorkspaceDatabase, readWorkspaceProject, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { downloadText, safeFilename } from "../lib/storage";
import "./chart.css";

type Accepted = ReturnType<typeof validateChartProject>;
type Stage = "choose" | "columns" | "mapping" | "review" | "workspace";
type Pending = { label: string; run: (signal: AbortSignal, extended: boolean) => Promise<void> };
type Mark = ChartSpec["mark"];
const fieldTypes: FieldType[] = ["string", "number", "date", "datetime", "boolean"];
const defaultFrame: ChartProject["frame"] = { theme: "porcelain", frame: "auto", padding: 32, showTitle: true, showBrand: true };
const category = (field: ChartField) => field.type === "string" || field.type === "date" || field.type === "boolean";
const xFields = (dataset: ChartDataset, mark: Mark) => dataset.fields.filter(field =>
  mark === "bar" ? category(field) : field.type === "number" || (mark === "line" && (field.type === "date" || field.type === "datetime")));

function mapping(dataset: ChartDataset, mark: Mark): ChartSpec {
  return {
    version: 1, mark, xField: xFields(dataset, mark)[0]?.id ?? "",
    yField: dataset.fields.find(field => field.type === "number")?.id ?? null, seriesField: null,
    aggregation: "none", ordering: mark === "line" ? "ascending" : "source",
    missing: mark === "line" ? "gap" : "exclude", nullCategory: "separate",
    duplicateX: mark === "line" ? "reject" : "keep-separate", connectMissing: false,
    xDomain: null, yDomain: null, filters: [], unitScale: { x: null, y: null },
    showClippingAnnotation: true, description: "",
  };
}

export default function ChartProjectDialog({ onBack, onClose, fromProjects = false }: {
  onBack: () => void; onClose: () => void; fromProjects?: boolean;
}) {
  const [stage, setStage] = useState<Stage>("choose");
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [drafts, setDrafts] = useState<ChartCheckpoint[]>([]);
  const [checkpoint, setCheckpoint] = useState<ChartCheckpoint>();
  const [format, setFormat] = useState<ChartInputFormat>(",");
  const [file, setFile] = useState<File>();
  const [raw, setRaw] = useState<ChartInput>();
  const [columns, setColumns] = useState<ColumnConfirmation[]>([]);
  const [dataset, setDataset] = useState<ChartDataset>();
  const [spec, setSpec] = useState<ChartSpec>();
  const [frame, setFrame] = useState(defaultFrame);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [candidate, setCandidate] = useState<Accepted>();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState<Pending>();
  const active = useRef<AbortController | null>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const stepFocus = useRef(false);

  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    if (stepFocus.current) stepHeading.current?.focus();
    stepFocus.current = true;
  }, [stage]);
  useEffect(() => {
    let current = true;
    void (async () => {
      const db = await openWorkspaceDatabase();
      try {
        const [ids, available] = await Promise.all([listWorkspaceProjectIds(db, "chart"), listChartCheckpoints(db)]);
        const entries = await Promise.all(ids.map(id => readWorkspaceProject(db, id, "chart")));
        if (current) {
          setProjects(entries.flatMap(entry => entry ? [{ id: entry.id, title: entry.document.title }] : []));
          setDrafts(available);
        }
      } finally {
        db.close();
      }
    })().catch(reason => { if (current) setError(reason instanceof Error ? reason.message : "Saved charts could not be loaded."); });
    return () => { current = false; };
  }, []);

  function resetNotice() { setError(""); setStatus(""); setRetry(undefined); }

  async function perform(job: Pending, extended = false) {
    if (active.current) return;
    resetNotice();
    const controller = new AbortController();
    active.current = controller;
    setBusy(job.label);
    try {
      await job.run(controller.signal, extended);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "The chart could not be prepared.");
      if (reason instanceof AuthoringWorkerTimeout && !extended) setRetry(job);
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy("");
    }
  }

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    setFile(selected);
    resetNotice();
    if (selected && (/\.(json|tsv)$/i).test(selected.name)) setFormat(selected.name.toLowerCase().endsWith(".json") ? "json" : "\t");
  }

  function readData() {
    if (!file) return;
    void perform({ label: "Reading chart data", async run(signal, extended) {
      if (file.size > chartDataLimits.bytes) throw new Error("Choose a file no larger than 2,000,000 bytes.");
      const bytes = await file.arrayBuffer();
      const data = await runAuthoringWorker<ChartInput>(() => new Worker(), { action: "read", bytes, format }, signal, "Reading the data", extended);
      signal.throwIfAborted();
      setFile(undefined);
      setRaw(data);
      setColumns(data.headings.map(name => ({ name, type: "string", unit: "", emptyIsNull: false })));
      setStage("columns");
    } });
  }

  function confirmColumns() {
    if (!raw) return;
    void perform({ label: "Checking the typed data", async run(signal, extended) {
      const typed = await runAuthoringWorker<ChartDataset>(() => new Worker(), { action: "confirm", input: raw, columns },
        signal, "Checking the typed data", extended);
      signal.throwIfAborted();
      setDataset(typed);
      setSpec(mapping(typed, "bar"));
      setCheckpoint(undefined);
      setRaw(undefined);
      setStage("mapping");
    } });
  }

  function review() {
    if (!dataset || !spec) return;
    resetNotice();
    try {
      const checked = validateChartProject({ schema: "meridian-chart/v1", documentKind: "chart",
        id: crypto.randomUUID(), revision: 0, updatedAt: new Date().toISOString(),
        title: title.trim() || "Untitled chart", subtitle, dataset, chartSpec: spec, frame });
      setCandidate(checked);
      setStage("review");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The chart mapping is invalid.");
    }
  }

  async function saveAccepted(accepted: Accepted, signal: AbortSignal) {
    const db = await openWorkspaceDatabase();
    try {
      signal.throwIfAborted();
      await writeWorkspaceProject(db, accepted.project, null);
      setCandidate(accepted);
      setStage("workspace");
    } finally {
      db.close();
    }
  }

  function create() {
    if (candidate) void perform({ label: "Saving the chart", async run(signal) {
      await saveAccepted(candidate, signal);
      if (checkpoint) {
        try {
          const db = await openWorkspaceDatabase();
          try { await discardGuidedCheckpoint(db, checkpoint); } finally { db.close(); }
        } catch {
          setStatus("Chart saved. Its draft could not be cleared.");
        }
      }
    } });
  }

  function saveDraft() {
    if (!dataset) return;
    void perform({ label: "Saving the chart draft", async run(signal) {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        const record = await saveChartCheckpoint(db, {
          title, subtitle, dataset, chartSpec: spec?.xField ? spec : null,
          delimiter: format === "\t" ? "tab" : format === ";" ? "semicolon" : "comma",
          conversions: dataset.fields.map((field, index) => ({
            fieldId: field.id, emptyToNull: columns[index]?.emptyIsNull ?? false,
            grouping: "none", decimal: "period", invalid: "block",
          })),
        }, checkpoint);
        setDrafts(previous => [record, ...previous.filter(item => item.id !== record.id)]);
        setCheckpoint(record);
        setStatus("Typed data and mapping draft saved in this browser.");
      } finally { db.close(); }
    } });
  }

  function resume(draft: ChartCheckpoint) {
    resetNotice();
    const { dataset, chartSpec, title, subtitle, delimiter, conversions } = draft.payload;
    setCheckpoint(draft);
    setTitle(title);
    setSubtitle(subtitle);
    setFormat(delimiter === "tab" ? "\t" : delimiter === "semicolon" ? ";" : ",");
    setDataset(dataset);
    setSpec(chartSpec ?? mapping(dataset, "bar"));
    setFrame(defaultFrame);
    setColumns(dataset.fields.map(({ id, name, type, unit }) => ({
      name, type, unit, emptyIsNull: conversions.find(conversion => conversion.fieldId === id)?.emptyToNull ?? false,
    })));
    setStage("mapping");
  }

  function discard(draft: ChartCheckpoint) {
    void perform({ label: "Discarding the chart draft", async run(signal) {
      const db = await openWorkspaceDatabase();
      try {
        signal.throwIfAborted();
        await discardGuidedCheckpoint(db, draft);
        setDrafts(previous => previous.filter(item => item.id !== draft.id));
        if (checkpoint?.id === draft.id) setCheckpoint(undefined);
        setStatus("Chart draft discarded.");
      } finally { db.close(); }
    } });
  }

  function openSaved(id: string) {
    void perform({ label: "Opening the saved chart", async run(signal) {
      const db = await openWorkspaceDatabase();
      try {
        const stored = await readWorkspaceProject(db, id, "chart");
        signal.throwIfAborted();
        if (!stored) throw new Error("The saved chart could not be found.");
        setCandidate(validateChartProject(stored.document));
        setStage("workspace");
      } finally {
        db.close();
      }
    } });
  }

  function importSaved(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!selected) return;
    void perform({ label: "Checking the chart project", async run(signal) {
      if (selected.size > chartDataLimits.bytes) throw new Error("Choose a project file no larger than 2,000,000 bytes.");
      const text = new TextDecoder("utf-8", { fatal: true }).decode(await selected.arrayBuffer());
      signal.throwIfAborted();
      const imported = parseChartProject(text);
      const project = { ...imported.project, id: crypto.randomUUID(), revision: 0, updatedAt: new Date().toISOString() };
      await saveAccepted({ ...imported, project }, signal);
    } });
  }

  function download(kind: "json" | "svg" | "html") {
    if (!candidate || !svg.current) return;
    const { project, projection } = candidate;
    const name = safeFilename(project.title);
    if (kind === "json") return downloadText(JSON.stringify(project), `${name}.meridian.json`);
    const serialized = new XMLSerializer().serializeToString(svg.current);
    if (kind === "svg") return downloadText(serialized, `${name}.svg`, "image/svg+xml;charset=utf-8");
    const { description } = describeChart(project, projection);
    downloadText(chartHtml(project.title, serialized, description, projection), `${name}.html`, "text/html;charset=utf-8");
  }

  const blocked = ["Saving the chart", "Saving the chart draft", "Discarding the chart draft", "Checking the chart project"].includes(busy);
  const heading = { choose: "Choose data", columns: "Confirm columns", mapping: "Map chart", review: "Review chart", workspace: candidate?.project.title ?? "Chart" }[stage];
  const changeColumn = (index: number, change: Partial<ColumnConfirmation>) => setColumns(previous =>
    previous.map((column, position) => position === index ? { ...column, ...change } : column));
  return <Modal title={fromProjects ? "Chart projects" : "Chart values"} wide busy={blocked} onClose={onClose}>
    <h3 tabIndex={-1} ref={stepHeading}>{heading}</h3>
    {stage === "choose" && <>
      {drafts.length > 0 && <ul className="project-list">
        {drafts.map(draft => <li className="project-row" key={draft.id}>
          <button className="project-open" disabled={!!busy} onClick={() => resume(draft)}><strong>Resume {draft.payload.title || "untitled chart"}</strong></button>
          <button className="button quiet" disabled={!!busy} onClick={() => discard(draft)} aria-label={`Discard draft ${draft.payload.title || "untitled chart"}`}>Discard draft</button>
        </li>)}
      </ul>}
      {projects.length > 0 && <ul className="project-list">
        {projects.map(project => <li className="project-row" key={project.id}>
          <button className="project-open" disabled={!!busy} onClick={() => openSaved(project.id)}><strong>{project.title}</strong></button>
        </li>)}
      </ul>}
      <form className="heading-form" onSubmit={event => { event.preventDefault(); readData(); }}>
        <label>Chart data file<input type="file" accept=".csv,.txt,.tsv,.json,text/plain,text/csv,application/json" disabled={!!busy} onChange={chooseFile} /></label>
        <label>Data format<select value={format} disabled={!!busy} onChange={event => { setFormat(event.target.value as ChartInputFormat); resetNotice(); }}>
          <option value=",">Comma-separated</option><option value="\t">Tab-separated</option><option value=";">Semicolon-separated</option><option value="json">JSON records</option>
        </select></label>
        <div className="dialog-actions">
          <button className="button quiet" type="button" disabled={!!busy} onClick={onBack}>Back</button>
          <button className="button primary" disabled={!file || !!busy}>Read data</button>
        </div>
      </form>
      <label className="chart-import">Import a Meridian chart project<input type="file" accept=".json,application/json" disabled={!!busy} onChange={importSaved} /></label>
    </>}
    {stage === "columns" && raw && <form className="heading-form" onSubmit={event => { event.preventDefault(); confirmColumns(); }}>
      <p>{raw.rows.length.toLocaleString()} rows · {columns.length} columns</p>
      <div className="chart-columns">
        {columns.map((column, index) => <fieldset key={index} disabled={!!busy}>
          <legend>{raw.headings[index] || `Column ${index + 1}`}</legend>
          <p className="muted-note">First row: {String(raw.rows[0]?.cells[index] ?? "Missing")}</p>
          <label>Name<input value={column.name} maxLength={200} onChange={event => changeColumn(index, { name: event.target.value })} /></label>
          <label>Type<select value={column.type} onChange={event => changeColumn(index, { type: event.target.value as FieldType })}>
            {fieldTypes.map(type => <option key={type} value={type}>{({ string: "Text", number: "Number", date: "Date", datetime: "Timestamp", boolean: "Boolean" })[type]}</option>)}
          </select></label>
          <label>Unit<input value={column.unit} maxLength={80} onChange={event => changeColumn(index, { unit: event.target.value })} /></label>
          <label className="chart-option"><input type="checkbox" checked={column.emptyIsNull} onChange={event => changeColumn(index, { emptyIsNull: event.target.checked })} />Treat empty fields as missing</label>
        </fieldset>)}
      </div>
      <p className="muted-note">Meridian keeps the confirmed typed data. It discards the input file bytes.</p>
      <div className="dialog-actions">
        <button className="button quiet" type="button" disabled={!!busy} onClick={() => { setStage("choose"); setRaw(undefined); resetNotice(); }}>Choose another file</button>
        <button className="button primary" disabled={!!busy}>Confirm columns</button>
      </div>
    </form>}
    {stage === "mapping" && dataset && spec && <form className="heading-form" onSubmit={event => { event.preventDefault(); review(); }}>
      <div className="chart-map">
        <label>Title<input maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Subtitle<input maxLength={240} value={subtitle} onChange={event => setSubtitle(event.target.value)} /></label>
        <label>Chart type<select value={spec.mark} onChange={event => setSpec(mapping(dataset, event.target.value as Mark))}>
          <option value="bar">Bar</option><option value="line">Line</option><option value="scatter">Scatter</option>
        </select></label>
        <label>X field<select value={spec.xField} onChange={event => setSpec({ ...spec, xField: event.target.value })}>
          <option value="">Choose a field</option>{xFields(dataset, spec.mark).map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select></label>
        <label>Y field<select disabled={spec.aggregation === "countRows"} value={spec.yField ?? ""} onChange={event => setSpec({ ...spec, yField: event.target.value || null })}>
          <option value="">Choose a numeric field</option>{dataset.fields.filter(field => field.type === "number").map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select></label>
        <label>Series field<select value={spec.seriesField ?? ""} onChange={event => setSpec({ ...spec, seriesField: event.target.value || null })}>
          <option value="">One series</option>{dataset.fields.filter(category).map(field => <option key={field.id} value={field.id}>{field.name}</option>)}
        </select></label>
        {spec.mark !== "scatter" && <label>Aggregation<select value={spec.aggregation} onChange={event => {
          const aggregation = event.target.value as ChartSpec["aggregation"];
          setSpec({ ...spec, aggregation, duplicateX: aggregation !== "none" ? "aggregate" : spec.mark === "bar" ? "keep-separate" : "reject",
            yField: aggregation === "countRows" ? null : spec.yField ?? dataset.fields.find(field => field.type === "number")?.id ?? null });
        }}>
          <option value="none">None</option><option value="sum">Sum</option><option value="mean">Mean</option>
          <option value="min">Minimum</option><option value="max">Maximum</option><option value="countRows">Count rows</option><option value="countValues">Count present values</option>
        </select></label>}
        <label>Chart theme<select value={frame.theme} onChange={event => setFrame({ ...frame, theme: event.target.value as ChartProject["frame"]["theme"] })}>
          {(["porcelain", "obsidian", "blueprint", "ember", "dusk", "moss"] as const).map(theme =>
            <option key={theme} value={theme}>{theme[0].toUpperCase() + theme.slice(1)}</option>)}
        </select></label>
      </div>
      <div className="dialog-actions">
        <button className="button quiet" type="button" disabled={!!busy} onClick={() => { setStage("choose"); resetNotice(); }}>Choose different data</button>
        <button className="button secondary" type="button" disabled={!!busy} onClick={saveDraft}>Save data draft</button>
        <button className="button primary" disabled={!!busy || !spec.xField || (!spec.yField && spec.aggregation !== "countRows")}>Review chart</button>
      </div>
    </form>}
    {(stage === "review" || stage === "workspace") && candidate && <>
      <ChartFigure project={candidate.project} values={candidate.projection} svgRef={svg} />
      <p>{describeChart(candidate.project, candidate.projection).description}</p>
      <ChartDataTable dataset={candidate.project.dataset} values={candidate.projection} />
      {stage === "review" ? <div className="dialog-actions">
        <button className="button quiet" disabled={!!busy} onClick={() => { setStage("mapping"); resetNotice(); }}>Back to mapping</button>
        <button className="button primary" disabled={!!busy} onClick={create}>Create chart project</button>
      </div> : <>
        <p role="status">Chart saved in this browser.</p>
        <div className="dialog-actions">
          <button className="button quiet" onClick={() => download("json")}>Download chart project</button>
          <button className="button quiet" onClick={() => download("svg")}>Download SVG</button>
          <button className="button primary" onClick={() => download("html")}>Download accessible HTML</button>
        </div>
      </>}
    </>}
    {busy && <p role="status">{busy}…</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert">{error}</p>}
    {retry && <button className="button secondary" onClick={() => void perform(retry, true)}>Retry with more time</button>}
  </Modal>;
}
