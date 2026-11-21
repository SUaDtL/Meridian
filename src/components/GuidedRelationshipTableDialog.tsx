import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Modal from "./Modal";
import GuidedCheckpointTimes from "./GuidedCheckpointTimes";
import GuidedAttachmentPicker, { emptyGuidedAttachment, GuidedAttachmentSummary, readyGuidedAttachment,
  type GuidedAttachmentTarget } from "./GuidedAttachmentPicker";
import type { GuidedAttachment } from "../lib/authoring/guided-systems-insertion";
import type { ReadyProposal } from "../lib/authoring/proposals";
import { AuthoringWorkerTimeout } from "../lib/authoring/authoring-worker";
import { tableInputLimits, type DelimitedRow, type TableDelimiter } from "../lib/authoring/delimited-input";
import { prepareGuidedFlowchart } from "../lib/authoring/guided-flowchart";
import { mapTableInWorker, readRelationshipTable } from "../lib/authoring/read-relationship-table";
import type { RelationshipColumns, RelationshipGraph } from "../lib/authoring/relationship-table";
import { buildExportFrame } from "../lib/export";
import { discardGuidedCheckpoint } from "../lib/persistence/guided-drafts";
import { listRelationshipCheckpoints, makeRelationshipCheckpoint, normalizedRelationshipDraft, saveRelationshipCheckpoint, type RelationshipCheckpoint } from "../lib/persistence/relationship-drafts";
import { openWorkspaceDatabase, writeWorkspaceProject } from "../lib/persistence/workspace-db";
import { downloadText } from "../lib/storage";

type Column = keyof RelationshipColumns;
type Columns = Record<Column, number | null>;
const names: Record<Column, string> = { label: "System label", id: "System ID", role: "Role", source: "Relationship source", target: "Relationship target" };
const emptyColumns: Columns = { label: null, id: null, role: null, source: null, target: null };

export type RelationshipTableDraft = {
  title: string;
  text: string;
  delimiter: TableDelimiter;
  header: boolean;
  rows?: DelimitedRow[];
  columns?: Columns;
  checkpoint?: RelationshipCheckpoint;
  recovered?: ReturnType<typeof normalizedRelationshipDraft>;
};
type PreparedTable = Pick<Awaited<ReturnType<typeof prepareGuidedFlowchart>>, "document" | "rendered">;
type Review = Pick<PreparedTable, "document"> & { url: string; graph: RelationshipGraph; proposal?: ReadyProposal };
type ExistingTarget = GuidedAttachmentTarget & {
  title: string;
  prepare: (graph: RelationshipGraph, attachment: GuidedAttachment | undefined,
    signal: AbortSignal) => Promise<PreparedTable & { proposal: ReadyProposal }>;
  apply: (proposal: ReadyProposal, signal: AbortSignal) => Promise<"applied" | "stale">;
  onCompleted: (draftRetained: boolean) => void;
};
type Props = {
  draft: RelationshipTableDraft;
  onDraft: Dispatch<SetStateAction<RelationshipTableDraft>>;
  onClose: () => void;
} & (
  | { target?: never; onCreated: (id: string, draftRetained?: boolean) => void; onProcess: () => void; onSystems: () => void }
  | { target: ExistingTarget; onCreated?: never; onProcess?: never; onSystems?: never }
);

export default function GuidedRelationshipTableDialog({ draft, onDraft, onCreated, onProcess, onSystems, onClose, target }: Props) {
  const [busy, setBusy] = useState<"file" | "read" | "checkpoint" | "preview" | "save" | "discard">();
  const [retry, setRetry] = useState<"once" | "narrow">();
  const [inputVisible, setInputVisible] = useState(!draft.rows && !draft.recovered);
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [savedDrafts, setSavedDrafts] = useState<RelationshipCheckpoint[]>([]);
  const [recoveryExport, setRecoveryExport] = useState<RelationshipCheckpoint>();
  const [review, setReview] = useState<Review>();
  const [painted, setPainted] = useState(false);
  const currentWork = useRef<AbortController | undefined>(undefined);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const reviewing = !!review;
  const recovered = draft.recovered;
  const reviewMapped = !!recovered;
  const columns = draft.columns ?? emptyColumns;
  const draftNodes = recovered?.graph.nodes.map(node => ({ id: node.key, label: `${node.label} (row ${node.sourceRow})` })) ?? [];
  useEffect(() => () => { currentWork.current?.abort(); }, []);
  useEffect(() => () => { if (review) URL.revokeObjectURL(review.url); }, [review]);
  useEffect(() => { if (!inputVisible) stageHeading.current?.focus(); }, [inputVisible, reviewing, reviewMapped]);
  useEffect(() => {
    let closed = false;
    void withDatabase(listRelationshipCheckpoints).then(records => { if (!closed) setSavedDrafts(records); }).catch(() => {
      if (!closed) setDraftError("Local table drafts could not be opened.");
    });
    return () => { closed = true; };
  }, []);

  function editInput(update: Partial<RelationshipTableDraft>) {
    target?.onAttachment(emptyGuidedAttachment);
    setError("");
    setRetry(undefined);
    onDraft(current => ({ ...current, ...update, rows: undefined, columns: undefined, recovered: undefined }));
  }

  async function readFile(file: File) {
    if (file.size > tableInputLimits.bytes) {
      setError("Use a table no larger than 2,000,000 bytes.");
      return;
    }
    await run("file", async signal => {
      const bytes = await file.arrayBuffer();
      signal.throwIfAborted();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      editInput({ text, delimiter: file.name.toLowerCase().endsWith(".tsv") ? "\t" : draft.delimiter });
    });
  }

  async function run(action: NonNullable<typeof busy>, task: (signal: AbortSignal) => Promise<void>, extended = false) {
    if (currentWork.current) return;
    const work = new AbortController();
    currentWork.current = work;
    setBusy(action);
    setError("");
    try { await task(work.signal); } catch (reason) {
      if (!work.signal.aborted) {
        if (reason instanceof AuthoringWorkerTimeout) setRetry(extended ? "narrow" : "once");
        setError(extended && reason instanceof AuthoringWorkerTimeout ? "Reduce the table before trying again."
          : reason instanceof Error ? reason.message : "The table could not be opened.");
      }
    } finally {
      currentWork.current = undefined;
      if (!work.signal.aborted) setBusy(undefined);
    }
  }

  function read(extended = false) {
    if (draft.rows) {
      setError("");
      setInputVisible(false);
      return;
    }
    return run("read", async signal => {
      const rows = await readRelationshipTable(draft.text, draft.delimiter, signal, extended);
      signal.throwIfAborted();
      if (!rows.length) throw new Error("Enter at least one row of table data.");
      onDraft(current => ({ ...current, rows, recovered: undefined }));
      setInputVisible(false);
      setRetry(undefined);
    }, extended);
  }

  async function prepare(signal: AbortSignal, extended: boolean) {
    const chosen = columns.label === null ? undefined : { ...columns, label: columns.label };
    const mapped = recovered ?? (draft.rows && chosen ? {
      columns: chosen, graph: await mapTableInWorker(draft.rows, chosen, draft.header, signal, extended),
    } : undefined);
    if (!mapped) return;
    setRetry(undefined);
    const { graph } = mapped;
    if (!draft.recovered) {
      setBusy("checkpoint");
      setDraftError("");
      setRecoveryExport(undefined);
      try {
        const saved = await withDatabase(db => saveRelationshipCheckpoint(db, draft.title, graph, mapped.columns, draft.checkpoint));
        onDraft(current => ({ ...current, checkpoint: saved }));
        setSavedDrafts(current => [saved, ...current.filter(item => item.id !== saved.id)]);
      } catch (reason) {
        setDraftError(reason instanceof Error ? reason.message : "The table draft could not be saved.");
        setRecoveryExport(makeRelationshipCheckpoint(draft.title, graph, mapped.columns, draft.checkpoint?.id ?? crypto.randomUUID(), Date.now()));
      }
      if (target) {
        onDraft(current => ({ ...current, recovered: mapped }));
        return;
      }
      setBusy("preview");
    }
    const prepared: PreparedTable & { proposal?: ReadyProposal } = target
      ? await target.prepare(graph, readyGuidedAttachment(target.attachment), signal)
      : await prepareGuidedFlowchart(draft.title.trim() || "Untitled systems diagram", { ...graph, direction: "LR" }, signal);
    const { document, rendered, proposal } = prepared;
    signal.throwIfAborted();
    const svg = buildExportFrame(rendered, document).svg;
    setPainted(false);
    setReview({ document, graph, proposal, url: URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) });
  }

  async function create(signal: AbortSignal) {
    if (!review || !painted) return;
    if (target) {
      if (!review.proposal) throw new Error("Preview the current insertion first.");
      if (await target.apply(review.proposal, signal) === "stale") {
        setReview(undefined);
        throw new Error("The saved project changed. Your mapping and attachment are still in this draft. Preview against the current project.");
      }
      const checkpoint = draft.checkpoint;
      const draftRetained = !!checkpoint &&
        await withDatabase(db => discardGuidedCheckpoint(db, checkpoint)).then(() => false, () => true);
      target.onCompleted(draftRetained);
      return;
    }
    const draftRetained = await withDatabase(async db => {
      await writeWorkspaceProject(db, review.document, null);
      return draft.checkpoint ? discardGuidedCheckpoint(db, draft.checkpoint).then(() => false, () => true) : false;
    });
    onCreated?.(review.document.id, draftRetained);
  }

  function resume(saved: RelationshipCheckpoint) {
    target?.onAttachment(emptyGuidedAttachment);
    setError("");
    setDraftError("");
    setRecoveryExport(undefined);
    onDraft({ title: saved.payload.title, text: "", header: true, delimiter: ",", checkpoint: saved, recovered: normalizedRelationshipDraft(saved) });
    setInputVisible(false);
  }

  async function discard(saved: RelationshipCheckpoint) {
    await withDatabase(db => discardGuidedCheckpoint(db, saved));
    setSavedDrafts(current => current.filter(item => item.id !== saved.id));
    onDraft(current => current.checkpoint?.id === saved.id ? { ...current, checkpoint: undefined } : current);
  }

  const headers = draft.rows?.[0]?.cells ?? [];
  const sample = draft.rows?.slice(draft.header ? 1 : 0, draft.header ? 6 : 5) ?? [];
  function preview() {
    const extended = retry === "once";
    return run("preview", signal => prepare(signal, extended), extended);
  }
  return (
    <Modal title={target ? "Insert relationship table" : "Systems and relationships"} wide
      initialFocus={target ? "[name='relationship-table']" : "[name='table-title']"} busy={busy === "checkpoint" || busy === "save" || busy === "discard"} onClose={onClose}>
      {inputVisible && <div className="heading-form">
        {!target && <>
          <button type="button" className="button quiet" disabled={!!busy} onClick={onProcess}>Process steps</button>
          <button type="button" className="button secondary" disabled={!!busy} onClick={onSystems}>Enter systems manually</button>
        </>}
        {!!savedDrafts.length && <ul className="project-list">{savedDrafts.map(saved => (
          <li className="project-row" key={saved.id}>
            <button type="button" className="project-open" disabled={!!busy} onClick={() => resume(saved)}>
              <span><strong>Resume {saved.payload.title || "Untitled systems diagram"}</strong>
                <small><GuidedCheckpointTimes checkpoint={saved} /></small></span>
            </button>
            <button type="button" className="button quiet" disabled={!!busy} aria-label={`Discard table draft ${saved.payload.title || "Untitled systems diagram"}`}
              onClick={() => void run("discard", () => discard(saved))}>Discard draft</button>
          </li>
        ))}</ul>}
        {target ? <p>Destination <strong>{target.title}</strong></p>
          : <label>Project title<input name="table-title" value={draft.title} maxLength={120} disabled={!!busy}
            onChange={event => onDraft(current => ({ ...current, title: event.target.value }))} /></label>}
        <label>Choose a CSV or TSV file<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={!!busy}
          onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); }} /></label>
        <label>Paste a relationship table<textarea name="relationship-table" rows={8} value={draft.text} readOnly={!!busy}
          onChange={event => editInput({ text: event.target.value })} /></label>
        <label>Delimiter<select value={draft.delimiter} disabled={!!busy}
          onChange={event => editInput({ delimiter: event.target.value === "\t" ? "\t" : "," })}>
          <option value=",">Comma</option><option value={"\t"}>Tab</option>
        </select></label>
        <p>Use one row per system. To include relationships, provide system IDs and source and target columns.</p>
        <div className="dialog-actions">
          <button type="button" className="button primary" disabled={!!busy || !draft.text || retry === "narrow"}
            onClick={() => void read(retry === "once")}>{retry === "once" ? "Retry for five seconds" : "Read table"}</button>
        </div>
      </div>}
      {!inputVisible && !review && recovered && <div>
        <h3 ref={stageHeading} tabIndex={-1}>{target ? "Review mapped systems" : "Resume mapped systems"}</h3>
        <p>{recovered.graph.nodes.length} systems · {recovered.graph.edges.length} relationships</p>
        <ul>{(Object.keys(names) as Column[]).map(key => {
          const column = recovered.columns[key];
          return <li key={key}>{names[key]} {column === null ? "was left unmapped" : `uses column ${column + 1}`}</li>;
        })}</ul>
        {target && <GuidedAttachmentPicker target={target} draftNodes={draftNodes} disabled={!!busy} />}
        <div className="dialog-actions">
          {target && draft.rows && <button type="button" className="button quiet" disabled={!!busy} onClick={() => {
            target.onAttachment(emptyGuidedAttachment);
            setError("");
            onDraft(current => ({ ...current, recovered: undefined }));
          }}>Back to mapping</button>}
          <button type="button" className="button quiet" disabled={!!busy} onClick={() => setInputVisible(true)}>Back to table input</button>
          <button type="button" className="button primary" disabled={!!busy} onClick={() => void preview()}>Preview relationships</button>
        </div>
      </div>}
      {!inputVisible && !review && !draft.recovered && <div className="heading-form">
        <h3 ref={stageHeading} tabIndex={-1}>Map table columns</h3>
        <label className="check-label"><input type="checkbox" checked={draft.header} disabled={!!busy}
          onChange={event => { setRetry(undefined); onDraft(current => ({ ...current, header: event.target.checked })); }} /> First row contains column names</label>
        <div className="relationship-table-sample">
          <table aria-label="First five data rows"><thead><tr>{headers.map((header, index) =>
            <th scope="col" key={index}>{draft.header && header ? header : `Column ${index + 1}`}</th>)}</tr></thead>
            <tbody>{sample.map(row => <tr key={row.line}>{headers.map((_, index) => <td key={index}>{row.cells[index]}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {(Object.keys(names) as Column[]).map(column => <label key={column}>{names[column]}
          <select value={columns[column] ?? ""} disabled={!!busy} onChange={event => {
            const chosen = event.target.value === "" ? null : Number(event.target.value);
            setRetry(undefined);
            onDraft(current => ({ ...current, columns: { ...(current.columns ?? emptyColumns), [column]: chosen } }));
          }}>
            <option value="">{column === "label" ? "Choose a column" : "Leave unmapped"}</option>
            {headers.map((header, index) => <option key={index} value={index}>Column {index + 1}{draft.header && header ? ` · ${header}` : ""}</option>)}
          </select>
        </label>)}
        <div className="dialog-actions">
          <button type="button" className="button quiet" disabled={!!busy} onClick={() => { setError(""); setInputVisible(true); }}>Back to table input</button>
          <button type="button" className="button primary" disabled={!!busy || columns.label === null || retry === "narrow"}
            onClick={() => void preview()}>{retry === "once" ? "Retry for five seconds"
              : target ? "Review mapped relationships" : "Preview relationships"}</button>
        </div>
      </div>}
      {review && <div className="migration-preview">
        <h3 ref={stageHeading} tabIndex={-1}>Review your systems diagram</h3>
        <p>{review.graph.nodes.length} systems · {review.graph.edges.length} relationships · {target ? target.title : "New project"}</p>
        <ul aria-label="Reviewed relationships">{review.graph.edges.map((edge, index) => {
          const from = review.graph.nodes.find(node => node.key === edge.from)!;
          const to = review.graph.nodes.find(node => node.key === edge.to)!;
          return <li key={index}>{from.label} (row {from.sourceRow}) → {to.label} (row {to.sourceRow})</li>;
        })}</ul>
        {target && <GuidedAttachmentSummary target={target} draftNodes={draftNodes} />}
        <img src={review.url} alt="Proposed systems diagram" onLoad={() => setPainted(true)} onError={() => setError("The preview image could not be displayed.")} />
        <div className="dialog-actions">
          <button type="button" className="button quiet" disabled={!!busy} onClick={() => setReview(undefined)}>{target ? "Back to mapped systems" : "Back to mapping"}</button>
          <button type="button" className="button primary" disabled={!painted || !!busy} onClick={() => void run("save", create)}>{target ? "Insert mapped systems" : "Create systems diagram"}</button>
        </div>
      </div>}
      <p role="status">{busy === "file" ? "Reading your file…" : busy === "read" ? "Reading table rows…"
        : busy === "checkpoint" ? "Saving the mapped draft…"
        : busy === "preview" ? "Checking and rendering the diagram…" : busy === "save" ? (target ? "Saving the insertion…" : "Saving the new project…")
          : !draftError && (review || draft.recovered) && draft.checkpoint ? <GuidedCheckpointTimes checkpoint={draft.checkpoint} status />
          : "Raw table inputs stay in this session."}</p>
      {draftError && <p role="alert">Session-only draft. {draftError}</p>}
      {recoveryExport && <button type="button" className="button quiet" onClick={() => downloadText(JSON.stringify(recoveryExport, null, 2), "systems.meridian-draft.json")}>Download normalized draft</button>}
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}

async function withDatabase<Result>(work: (db: IDBDatabase) => Promise<Result>) {
  const db = await openWorkspaceDatabase();
  try { return await work(db); } finally { db.close(); }
}
