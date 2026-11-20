import { useRef, useState } from "react";
import { chartTableRuntime } from "../lib/chart-table-runtime";
import { exportScriptHash } from "../lib/export-script-hash";
import type { ChartDataset, ChartScale } from "../lib/authoring/chart-data";
import type { ChartValue } from "../lib/authoring/chart-numbers";
import { chartCategory, type ChartProjection } from "./ChartFigure";

type ReadableTable = { name: string; headings: string[]; rows: { id: string; values: string[] }[] };
const pageSize = 50;
const exactDisplay = (value: ChartValue | null) => {
  if (!value) return "Missing";
  const { exact, approximate, display } = value;
  return approximate ? `≈ ${display} (exact ${exact.numerator}/${exact.denominator})` : display;
};

export function displayedChartTable(projection: ChartProjection): ReadableTable {
  const { x, y, series, observations, unitScale } = projection;
  const heading = (name: string, scale: ChartScale | null) =>
    scale ? `${name} (× 10^${scale.power10}${scale.unitLabel ? ` · ${scale.unitLabel}` : ""})` : name;
  return {
    name: "Displayed values",
    headings: [heading(x.name, unitScale.x), heading(y?.name ?? "Row count", unitScale.y), ...(series ? [series.name] : []), "Rows", "Present values", "Status"],
    rows: observations.map(point => ({
      id: point.rowIds[0],
      values: [
        point.numericX ? exactDisplay(point.numericX) : chartCategory(point.x), exactDisplay(point.y),
        ...(series ? [chartCategory(point.series)] : []), String(point.rowIds.length), String(point.countValues),
        [point.outside && "Outside range", point.y === null && "Missing Y", point.overlap > 1 && `${point.overlap} overlapping points`].filter(Boolean).join(" · ") || "Included",
      ],
    })),
  };
}

function sourceChartTable(dataset: ChartDataset, exclusions: ChartProjection["filterExclusions"]): ReadableTable {
  const showFilters = Object.keys(exclusions).length > 0;
  return {
    name: "Source data",
    headings: [...dataset.fields.map(field => field.unit ? `${field.name} (${field.unit})` : field.name), ...(showFilters ? ["Filter status"] : [])],
    rows: dataset.rows.map(({ id, cells }) => {
      const values = cells.map(cell => cell === null ? "Missing" : String(cell));
      if (showFilters) values.push(exclusions[id] ? `Excluded by filter ${exclusions[id]}` : "Passed filters");
      return { id, values };
    }),
  };
}

function Table({ data }: { data: ReadableTable }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [focused, setFocused] = useState("");
  const [activeRow, setActiveRow] = useState(0);
  const [hidden, setHidden] = useState<ReadonlySet<number>>(new Set());
  const table = useRef<HTMLTableElement>(null);
  const term = query.trim().toLowerCase();
  const rows = term ? data.rows.filter(row => row.values.some(value => value.toLowerCase().includes(term))) : data.rows;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const start = currentPage * pageSize;
  const active = rows.slice(start, start + pageSize);
  const focusIndex = Math.min(activeRow, active.length - 1);
  return <section className="chart-data-panel" aria-label={data.name}>
    <label>Find a value in {data.name.toLowerCase()}
      <input value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setPage(0); setFocused(""); setActiveRow(0); }} />
    </label>
    <details className="chart-table-columns">
      <summary>Choose columns</summary>
      <fieldset>
        <legend>{data.name} columns</legend>
        {data.headings.map((heading, index) => <label key={index} className="check-label">
          <input type="checkbox" checked={!hidden.has(index)} disabled={!hidden.has(index) && hidden.size === data.headings.length - 1}
            onChange={event => {
              const next = new Set(hidden);
              if (event.target.checked) next.delete(index);
              else next.add(index);
              setHidden(next);
            }} /> {heading}
        </label>)}
      </fieldset>
    </details>
    <p role="status">{rows.length ? `Rows ${start + 1}–${start + active.length} of ${rows.length}` : "No matching rows."}{focused && `. ${focused}`}</p>
    <div className="chart-table-scroll" tabIndex={0} aria-label={`${data.name} table`}>
      <table ref={table}>
        <caption>{data.name}</caption>
        <thead><tr>{data.headings.map((heading, index) => !hidden.has(index) && <th key={index} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{active.map(({ id, values }, index) => <tr key={id} tabIndex={index === focusIndex ? 0 : -1}
          onFocus={() => { setActiveRow(index); setFocused(`Focused row ${start + index + 1}, ${values[0]}.`); }}
          onKeyDown={event => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
            const offsets: Record<string, number> = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: active.length - 1 };
            if (!Object.hasOwn(offsets, event.key)) return;
            event.preventDefault();
            const next = Math.max(0, Math.min(active.length - 1, offsets[event.key]));
            table.current?.tBodies[0]?.rows[next]?.focus();
          }}>
          {values.map((value, column) => !hidden.has(column) && <td key={column}>{value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="dialog-actions">
      <button type="button" className="button quiet" disabled={!currentPage} onClick={() => { setPage(currentPage - 1); setFocused(""); setActiveRow(0); }}>Previous rows</button>
      <button type="button" className="button quiet" disabled={start + pageSize >= rows.length}
        onClick={() => { setPage(currentPage + 1); setFocused(""); setActiveRow(0); }}>Next rows</button>
    </div>
  </section>;
}

export default function ChartDataTable({ values, dataset }: { values: ChartProjection; dataset: ChartDataset }) {
  const [view, setView] = useState<"displayed" | "source">("displayed");
  return <>
    <div role="group" aria-label="Chart data views" className="chart-data-views">
      <button className="button quiet" aria-pressed={view === "displayed"} onClick={() => setView("displayed")}>Displayed values</button>
      <button className="button quiet" aria-pressed={view === "source"} onClick={() => setView("source")}>Source data</button>
    </div>
    <Table key={view} data={view === "displayed" ? displayedChartTable(values) : sourceChartTable(dataset, values.filterExclusions)} />
  </>;
}

function escapeText(value: string) {
  return value.replace(/[&<>]/g, match => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[match]!);
}

export async function chartHtml(title: string, svg: string, description: string, values: ChartProjection) {
  const { headings, rows } = displayedChartTable(values);
  const script = `(${chartTableRuntime.toString()})();`.replace(/<\/script/gi, "<\\/script");
  const hash = await exportScriptHash(script);
  const columns = headings.map((label, index) =>
    `<label><input type="checkbox" data-table-column="${index}" checked> ${escapeText(label)}</label>`).join("");
  const controls = `<section data-table-controls hidden>
<label>Find a value in displayed values <input type="search" data-table-search maxlength="200"></label>
<details><summary>Choose columns</summary><fieldset><legend>Displayed values columns</legend>${columns}</fieldset></details>
<p data-table-status role="status"></p></section>`;
  const heading = headings.map(value => `<th scope="col">${escapeText(value)}</th>`).join("");
  const pages = [];
  for (let start = 0; start < rows.length; start += pageSize) {
    const entries = rows.slice(start, start + pageSize);
    const label = `Rows ${start + 1}–${start + entries.length} of ${rows.length}`;
    const body = entries.map(({ values }) => `<tr>${values.map(value => `<td>${escapeText(value)}</td>`).join("")}</tr>`).join("");
    pages.push(`<details data-table-page="${start}"${start === 0 ? " open" : ""}><summary>${label}</summary><div class="table"><table><caption>Displayed values, ${label}</caption><thead><tr>${heading}</tr></thead><tbody>${body}</tbody></table></div></details>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; connect-src 'none'; object-src 'none'; base-uri 'none'">
<title>${escapeText(title)} · Meridian</title><style>[hidden]{display:none!important}fieldset label{display:block}tr:focus-visible{outline:2px solid #1d4ed8;outline-offset:-2px}body{font:16px/1.55 system-ui,sans-serif;margin:0;padding:1rem;background:#f7f8fb;color:#172131}main{max-width:58rem;margin:auto}svg{width:100%;height:auto;display:block}details{margin:.65rem 0;padding:.65rem;background:#fff;border:1px solid #ccd2df;border-radius:.45rem}summary{cursor:pointer;font-weight:600}.table{overflow:auto}table{width:100%;border-collapse:collapse;min-width:24rem}th,td{text-align:left;border-bottom:1px solid #d9dee9;padding:.5rem}caption{text-align:left;padding:.5rem 0}</style></head>
<body><main><h1>${escapeText(title)}</h1>${svg}<p>${escapeText(description)}</p><h2>Displayed values</h2>${controls}${pages.join("") || "<p>No displayed values.</p>"}</main><script>${script}</script></body></html>`;
}
