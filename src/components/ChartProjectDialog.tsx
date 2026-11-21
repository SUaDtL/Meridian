import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Modal from "./Modal";
import ChartFigure, { describeChart } from "./ChartFigure";
import ChartDataTable, { chartHtml } from "./ChartDataTable";
import ChartFilterEditor from "./ChartFilterEditor";
import ChartAxisScale from "./ChartAxisScale";
import { AuthoringWorkerTimeout, runAuthoringWorker } from "../lib/authoring/authoring-worker";
import Worker from "../lib/authoring/chart-input.worker?worker&inline";
import { chartDataLimits, chartJsonBytes, convertChartCell, type ChartDataset, type ChartField, type ChartProject, type ChartSpec, type FieldType } from "../lib/authoring/chart-data";
import { openChartProjectEditor } from "../lib/authoring/chart-editor";
import type { ChartInput, ChartInputFormat, ColumnConfirmation, ConfirmedChartInput } from "../lib/authoring/chart-input";
import { canonicalChartNumber, type NumberLocale } from "../lib/authoring/chart-numbers";
import { parseChartProject, validateChartProject } from "../lib/authoring/chart-project";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { listChartCheckpoints, saveChartCheckpoint, type ChartCheckpoint } from "../lib/persistence/chart-drafts";
import { discardGuidedCheckpoint } from "../lib/persistence/guided-drafts";
import type { ProjectSaveState } from "../lib/persistence/project-save-queue";
import { listWorkspaceProjectIds, openWorkspaceDatabase, readWorkspaceProject, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { downloadText, MAX_PROJECT_FILE_BYTES, safeFilename } from "../lib/storage";
import "./chart.css";

type Accepted = ReturnType<typeof validateChartProject>;
type ChartEditor = Awaited<ReturnType<typeof openChartProjectEditor>>;
type Stage = "choose" | "columns" | "mapping" | "review" | "workspace";
type Pending = { label: string; run: (signal: AbortSignal, extended: boolean) => Promise<void> };
type Mark = ChartSpec["mark"];
const fieldTypes: FieldType[] = ["string", "number", "date", "datetime", "boolean"];
const defaultLocale: NumberLocale = { decimal: "period", grouping: "none" };
const byteCount = new Intl.NumberFormat();
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

function ConversionSummary({ dataset, counts }: {
  dataset: ChartDataset;
  counts: ConfirmedChartInput["conversions"] | undefined;
}) {
  const changed = counts?.filter(item => item.invalid || item.empty).flatMap(item => {
    const field = dataset.fields.find(candidate => candidate.id === item.fieldId);
    return field ? [{ ...item, name: field.name }] : [];
  });
  if (!changed?.length) return null;
  return <section aria-label="Data conversion">
    <h3>Values converted to missing</h3>
    <ul>{changed.map(item => <li key={item.fieldId}>{item.name} · {item.invalid} invalid · {item.empty} empty</li>)}</ul>
  </section>;
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
  const [conversions, setConversions] = useState<ConfirmedChartInput["conversions"]>();
  const [spec, setSpec] = useState<ChartSpec>();
  const [frame, setFrame] = useState(defaultFrame);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [candidate, setCandidate] = useState<Accepted>();
  const reviewDataset = stage === "review" ? candidate?.project.dataset : undefined;
  const datasetBytes = useMemo(() => reviewDataset && chartJsonBytes(reviewDataset), [reviewDataset]);
  const [editProposal, setEditProposal] = useState<ReadyProposal>();
  const [saveState, setSaveState] = useState<ProjectSaveState>();
  const [acceptTruncatedAxis, setAcceptTruncatedAxis] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [retry, setRetry] = useState<Pending>();
  const active = useRef<AbortController | null>(null);
  const chartSession = useRef<{ db: IDBDatabase; editor: ChartEditor } | null>(null);
  const editingBase = useRef<ChartProject | undefined>(undefined);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const stepFocus = useRef(false);

  useEffect(() => () => {
    active.current?.abort();
    chartSession.current?.editor.dispose();
    chartSession.current?.db.close();
  }, []);
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
      const typed = await runAuthoringWorker<ConfirmedChartInput>(() => new Worker(), { action: "confirm", input: raw, columns },
        signal, "Checking the typed data", extended);
      signal.throwIfAborted();
      setDataset(typed.dataset);
      setConversions(typed.conversions);
      setSpec(mapping(typed.dataset, "bar"));
      setCheckpoint(undefined);
      setRaw(undefined);
      setStage("mapping");
    } });
  }

  function review() {
    if (!dataset || !spec) return;
    void perform({ label: "Checking the chart preview", async run(signal) {
      let yDomain: string[] | null = null;
      let xDomain: string[] | null = null;
      if (spec.xDomain) {
        const field = dataset.fields.find(item => item.id === spec.xField);
        if (!field || !["number", "date", "datetime"].includes(field.type)) throw new Error("Choose a numeric or time field for the custom X range.");
        try { xDomain = spec.xDomain.map(value => convertChartCell(value, field.type) as string); }
        catch { throw new Error("Enter two valid limits for the selected X field."); }
      }
      if (spec.yDomain) {
        try { yDomain = spec.yDomain.map(canonicalChartNumber); }
        catch { throw new Error("Enter two valid decimals for the custom Y range."); }
      }
      if (spec.mark === "bar" && yDomain && (Number(yDomain[0]) > 0 || Number(yDomain[1]) < 0) && !acceptTruncatedAxis) {
        throw new Error("Accept the truncated bar axis before previewing a range that excludes zero.");
      }
      const edit = { title: title.trim() || "Untitled chart", subtitle, chartSpec: { ...spec, xDomain, yDomain }, frame };
      const session = chartSession.current;
      if (session && editingBase.current) {
        const prepared = await session.editor.prepare(edit, editingBase.current);
        signal.throwIfAborted();
        setEditProposal(prepared.proposal);
        setCandidate(prepared.next);
      } else {
        setCandidate(validateChartProject({ schema: "meridian-chart/v1", documentKind: "chart",
          id: crypto.randomUUID(), revision: 0, updatedAt: new Date().toISOString(), dataset, ...edit }));
      }
      setStage("review");
    } });
  }

  async function startSession(db: IDBDatabase, id: string, signal: AbortSignal) {
    const editor = await openChartProjectEditor(db, id, setSaveState);
    if (signal.aborted) {
      editor.dispose();
      signal.throwIfAborted();
    }
    const previous = chartSession.current;
    previous?.editor.dispose();
    if (previous && previous.db !== db) previous.db.close();
    chartSession.current = { db, editor };
    setSaveState(editor.saveState());
    setCandidate(editor.snapshot());
    setStage("workspace");
  }

  async function saveAccepted(accepted: Accepted, signal: AbortSignal) {
    const db = await openWorkspaceDatabase();
    try {
      signal.throwIfAborted();
      await writeWorkspaceProject(db, accepted.project, null);
      await startSession(db, accepted.project.id, signal);
    } catch (reason) {
      db.close();
      throw reason;
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
            ...(field.type === "number" ? columns[index]?.numeric ?? defaultLocale : defaultLocale),
            invalid: columns[index]?.invalidToNull ? "null" : "block",
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
    setConversions(undefined);
    setSpec(chartSpec ?? mapping(dataset, "bar"));
    setFrame(defaultFrame);
    setAcceptTruncatedAxis(false);
    setColumns(dataset.fields.map(({ id, name, type, unit }) => {
      const conversion = conversions.find(item => item.fieldId === id);
      return { name, type, unit, emptyIsNull: conversion?.emptyToNull ?? false,
        invalidToNull: conversion?.invalid === "null",
        numeric: conversion ? { decimal: conversion.decimal, grouping: conversion.grouping } : undefined };
    }));
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
        await startSession(db, id, signal);
      } catch (reason) {
        db.close();
        throw reason;
      }
    } });
  }

  function editSaved() {
    const current = chartSession.current?.editor.snapshot().project;
    if (!current) return;
    editingBase.current = current;
    resetNotice();
    setDataset(current.dataset);
    setSpec(current.chartSpec);
    setTitle(current.title);
    setSubtitle(current.subtitle);
    setFrame(current.frame);
    setAcceptTruncatedAxis(current.chartSpec.yDomain !== null);
    setStage("mapping");
  }

  function saveSeparateChart() {
    const snapshot = chartSession.current?.editor.snapshot();
    if (!snapshot) return;
    void perform({ label: "Saving the chart", async run(signal) {
      const project = { ...snapshot.project, id: crypto.randomUUID(), revision: 0, updatedAt: new Date().toISOString() };
      await saveAccepted({ ...snapshot, project }, signal);
      setStatus("Saved as a separate chart project.");
    } });
  }

  function returnToSaved() {
    const current = chartSession.current?.editor.snapshot();
    if (!current) return;
    editingBase.current = undefined;
    resetNotice();
    setCandidate(current);
    setEditProposal(undefined);
    setStage("workspace");
  }

  function applyEdit() {
    const editor = chartSession.current?.editor;
    if (!editor || !editProposal) return;
    void perform({ label: "Applying chart changes", async run(signal) {
      signal.throwIfAborted();
      const result = await editor.apply(editProposal);
      if (result === "applied" || result === "unchanged") returnToSaved();
      else throw new Error(result === "stale" ? "The chart changed. Reopen its mapping before previewing changes." : "The chart could not reserve Undo for this edit.");
    } });
  }

  function changeHistory(action: "undo" | "redo") {
    const editor = chartSession.current?.editor;
    if (!editor) return;
    void perform({ label: action === "undo" ? "Undoing chart changes" : "Redoing chart changes", async run() {
      if (editor[action]()) setCandidate(editor.snapshot());
    } });
  }

  function closeChart() {
    const editor = chartSession.current?.editor;
    if (!editor || editor.saveState().phase === "saved") { onClose(); return; }
    void perform({ label: "Saving before closing", async run() {
      await editor.flush();
      if (editor.saveState().phase === "saved") onClose();
      else throw new Error("Your changes are still open. Download the chart project before closing.");
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
    void perform({ label: "Preparing accessible HTML", async run(signal) {
      const html = await chartHtml(project.title, serialized, description, projection);
      signal.throwIfAborted();
      downloadText(html, `${name}.html`, "text/html;charset=utf-8");
    } });
  }

  const editing = !!editingBase.current;
  const blocked = ["Saving the chart", "Saving the chart draft", "Discarding the chart draft", "Checking the chart project", "Applying chart changes", "Saving before closing"].includes(busy);
  const heading = { choose: "Choose data", columns: "Confirm columns", mapping: "Map chart", review: "Review chart", workspace: candidate?.project.title ?? "Chart" }[stage];
  const changeColumn = (index: number, change: Partial<ColumnConfirmation>) => setColumns(previous =>
    previous.map((column, position) => position === index ? { ...column, ...change } : column));
  return <Modal title={fromProjects ? "Chart projects" : "Chart values"} wide busy={blocked} onClose={closeChart}>
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
          {column.type === "number" && raw.format !== "json" && <>
            <label>Decimal separator<select value={column.numeric?.decimal ?? defaultLocale.decimal} onChange={event => {
              const decimal = event.target.value as NumberLocale["decimal"];
              const previous = column.numeric?.grouping ?? defaultLocale.grouping;
              changeColumn(index, { numeric: { decimal, grouping: previous === decimal ? "none" : previous } });
            }}><option value="period">Period</option><option value="comma">Comma</option></select></label>
            <label>Thousands separator<select value={column.numeric?.grouping ?? defaultLocale.grouping} onChange={event => {
              changeColumn(index, { numeric: { decimal: column.numeric?.decimal ?? defaultLocale.decimal, grouping: event.target.value as NumberLocale["grouping"] } });
            }}>
              <option value="none">None</option>
              <option value="period" disabled={(column.numeric?.decimal ?? defaultLocale.decimal) === "period"}>Period</option>
              <option value="comma" disabled={column.numeric?.decimal === "comma"}>Comma</option>
              <option value="space">Space</option>
            </select></label>
          </>}
          <label className="chart-option"><input type="checkbox" checked={column.emptyIsNull} onChange={event => changeColumn(index, { emptyIsNull: event.target.checked })} />Treat empty fields as missing</label>
          <label>Invalid values<select value={column.invalidToNull ? "null" : "block"}
            onChange={event => changeColumn(index, { invalidToNull: event.target.value === "null" })}>
            <option value="block">Require valid values</option><option value="null">Convert invalid nonempty values to missing</option>
          </select></label>
        </fieldset>)}
      </div>
      <p className="muted-note">Meridian keeps the confirmed typed data. It discards the input file bytes.</p>
      <div className="dialog-actions">
        <button className="button quiet" type="button" disabled={!!busy} onClick={() => { setStage("choose"); setRaw(undefined); resetNotice(); }}>Choose another file</button>
        <button className="button primary" disabled={!!busy}>Confirm columns</button>
      </div>
    </form>}
    {stage === "mapping" && dataset && spec && <form className="heading-form" onSubmit={event => { event.preventDefault(); review(); }}>
      <ConversionSummary dataset={dataset} counts={conversions} />
      {!conversions && !editing && columns.some(column => column.invalidToNull) && <p>
        The restored draft uses the reviewed missing-value rules. Original conversion counts are available during file import.
      </p>}
      <div className="chart-map">
        <label>Title<input maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label>Subtitle<input maxLength={240} value={subtitle} onChange={event => setSubtitle(event.target.value)} /></label>
        <label>Chart type<select value={spec.mark} onChange={event => setSpec({ ...mapping(dataset, event.target.value as Mark), filters: spec.filters })}>
          <option value="bar">Bar</option><option value="line">Line</option><option value="scatter">Scatter</option>
        </select></label>
        <label>X field<select value={spec.xField} onChange={event => setSpec({ ...spec, xField: event.target.value,
          xDomain: null, unitScale: { ...spec.unitScale, x: null } })}>
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
          const counting = aggregation === "countRows" || aggregation === "countValues";
          setSpec({ ...spec, aggregation, unitScale: counting ? { ...spec.unitScale, y: null } : spec.unitScale,
            duplicateX: aggregation !== "none" ? "aggregate" : spec.mark === "bar" ? "keep-separate" : "reject",
            yField: aggregation === "countRows" ? null : spec.yField ?? dataset.fields.find(field => field.type === "number")?.id ?? null });
        }}>
          <option value="none">None</option><option value="sum">Sum</option><option value="mean">Mean</option>
          <option value="min">Minimum</option><option value="max">Maximum</option><option value="countRows">Count rows</option><option value="countValues">Count present values</option>
        </select></label>}
        <label>Chart theme<select value={frame.theme} onChange={event => setFrame({ ...frame, theme: event.target.value as ChartProject["frame"]["theme"] })}>
          {(["porcelain", "obsidian", "blueprint", "ember", "dusk", "moss"] as const).map(theme =>
            <option key={theme} value={theme}>{theme[0].toUpperCase() + theme.slice(1)}</option>)}
        </select></label>
        <label>Frame ratio<select value={frame.frame} onChange={event => setFrame({ ...frame, frame: event.target.value as ChartProject["frame"]["frame"] })}>
          <option value="auto">Automatic</option><option value="16:9">16:9</option><option value="4:3">4:3</option><option value="1:1">Square</option>
        </select></label>
        <label>Frame padding<input type="number" min={0} max={240} value={Number.isFinite(frame.padding) ? frame.padding : ""}
          onChange={event => setFrame({ ...frame, padding: event.target.valueAsNumber })} /></label>
      </div>
      <label className="check-label"><input type="checkbox" checked={frame.showTitle} onChange={event => setFrame({ ...frame, showTitle: event.target.checked })} />Show the title and subtitle</label>
      <label className="check-label"><input type="checkbox" checked={frame.showBrand} onChange={event => setFrame({ ...frame, showBrand: event.target.checked })} />Show the Meridian signature</label>
      {spec.mark !== "bar" && spec.xField && <>
        <label className="check-label"><input type="checkbox" checked={spec.xDomain !== null} onChange={event =>
          setSpec({ ...spec, xDomain: event.target.checked ? ["", ""] : null })} />Set a custom X range</label>
        {spec.xDomain && <div className="chart-map">
          {["X minimum", "X maximum"].map((label, index) => <label key={label}>{label}
            <input value={spec.xDomain?.[index] ?? ""} maxLength={64} onChange={event => {
              const limits = [...spec.xDomain!];
              limits[index] = event.target.value;
              setSpec({ ...spec, xDomain: limits });
            }} />
          </label>)}
        </div>}
        {dataset.fields.some(field => field.id === spec.xField && field.type === "number") &&
          <ChartAxisScale axis="X" scale={spec.unitScale.x} onChange={x => setSpec({ ...spec, unitScale: { ...spec.unitScale, x } })} />}
      </>}
      {spec.yField && spec.aggregation !== "countRows" && spec.aggregation !== "countValues" &&
        <ChartAxisScale axis="Y" scale={spec.unitScale.y} onChange={y => setSpec({ ...spec, unitScale: { ...spec.unitScale, y } })} />}
      {(spec.unitScale.x || spec.unitScale.y) && <p className="muted-note">Custom limits use the displayed units.</p>}
      <label className="check-label"><input type="checkbox" checked={spec.yDomain !== null} onChange={event => {
        setAcceptTruncatedAxis(false);
        setSpec({ ...spec, yDomain: event.target.checked ? ["", ""] : null });
      }} />Set a custom Y range</label>
      {spec.yDomain && <>
        <div className="chart-map">
          {["Y minimum", "Y maximum"].map((label, index) => <label key={label}>{label}
            <input value={spec.yDomain?.[index] ?? ""} inputMode="decimal" maxLength={64} onChange={event => {
              const limits = [...spec.yDomain!];
              limits[index] = event.target.value;
              setAcceptTruncatedAxis(false);
              setSpec({ ...spec, yDomain: limits });
            }} />
          </label>)}
        </div>
        {spec.mark === "bar" && <label className="check-label"><input type="checkbox" checked={acceptTruncatedAxis}
          onChange={event => setAcceptTruncatedAxis(event.target.checked)} />Accept a truncated axis if the range excludes zero</label>}
      </>}
      <ChartFilterEditor dataset={dataset} filters={spec.filters} disabled={!!busy}
        onChange={filters => setSpec({ ...spec, filters })} />
      <div className="dialog-actions">
        {editing ? <button className="button quiet" type="button" disabled={!!busy} onClick={returnToSaved}>Cancel chart changes</button> : <>
          <button className="button quiet" type="button" disabled={!!busy} onClick={() => { setStage("choose"); resetNotice(); }}>Choose different data</button>
          <button className="button secondary" type="button" disabled={!!busy} onClick={saveDraft}>Save data draft</button>
        </>}
        <button className="button primary" disabled={!!busy || !spec.xField || (!spec.yField && spec.aggregation !== "countRows")}>Review chart</button>
      </div>
    </form>}
    {(stage === "review" || stage === "workspace") && candidate && <>
      <ConversionSummary dataset={candidate.project.dataset} counts={conversions} />
      {datasetBytes !== undefined && <section aria-label="Chart storage">
        <h3>Chart storage</h3>
        <p>Typed dataset {byteCount.format(datasetBytes)} of {byteCount.format(chartDataLimits.datasetBytes)} bytes.</p>
        <p>Complete project {byteCount.format(candidate.projectBytes)} of {byteCount.format(MAX_PROJECT_FILE_BYTES)} bytes.</p>
        <p>The project keeps the typed dataset, including rows excluded by the current chart mapping.</p>
      </section>}
      <ChartFigure project={candidate.project} values={candidate.projection} svgRef={svg} />
      <p>{describeChart(candidate.project, candidate.projection).description}</p>
      <ChartDataTable dataset={candidate.project.dataset} values={candidate.projection} />
      {stage === "review" ? <div className="dialog-actions">
        <button className="button quiet" disabled={!!busy} onClick={() => { setStage("mapping"); resetNotice(); }}>Back to mapping</button>
        <button className="button primary" disabled={!!busy} onClick={editing ? applyEdit : create}>{editing ? "Apply chart changes" : "Create chart project"}</button>
      </div> : <>
        <p role="status">{saveState?.phase === "saved" ? "Chart saved in this browser."
          : saveState?.phase === "error" || saveState?.phase === "conflict" ? saveState.message : "Saving chart changes…"}</p>
        <div className="dialog-actions">
          <button type="button" className="button secondary" disabled={!!busy} onClick={editSaved}>Edit chart mapping and frame</button>
          <button type="button" className="button quiet" disabled={!!busy || !chartSession.current?.editor.canUndo()} onClick={() => changeHistory("undo")}>Undo</button>
          <button type="button" className="button quiet" disabled={!!busy || !chartSession.current?.editor.canRedo()} onClick={() => changeHistory("redo")}>Redo</button>
        </div>
        {(saveState?.phase === "error" || saveState?.phase === "conflict") && <div className="dialog-actions">
          {saveState.phase === "error" && <button className="button secondary" disabled={!!busy} onClick={() => {
            void perform({ label: "Retrying chart save", async run() { await chartSession.current?.editor.retry(); } });
          }}>Retry chart save</button>}
          {saveState.phase === "conflict" && <button className="button secondary" disabled={!!busy} onClick={saveSeparateChart}>Save as a separate chart</button>}
          <button className="button quiet" disabled={!!busy} onClick={onClose}>Close chart with unsaved changes</button>
        </div>}
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
