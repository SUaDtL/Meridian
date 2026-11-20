import { useState } from "react";
import type { ChartDataset } from "../lib/authoring/chart-data";
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
  const { x, y, series, observations } = projection;
  return {
    name: "Displayed values",
    headings: [x.name, y?.name ?? "Row count", ...(series ? [series.name] : []), "Rows", "Present values", "Status"],
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
  const term = query.trim().toLocaleLowerCase();
  const rows = term ? data.rows.filter(row => row.values.some(value => value.toLocaleLowerCase().includes(term))) : data.rows;
  const start = page * pageSize;
  const active = rows.slice(start, start + pageSize);
  return <section className="chart-data-panel" aria-label={data.name}>
    <label>Find a value in {data.name.toLowerCase()}
      <input value={query} maxLength={200} onChange={event => { setQuery(event.target.value); setPage(0); setFocused(""); }} />
    </label>
    <p role="status">{rows.length ? `Rows ${start + 1}–${start + active.length} of ${rows.length}` : "No matching rows."}{focused && `. ${focused}`}</p>
    <div className="chart-table-scroll" tabIndex={0} aria-label={`${data.name} table`}>
      <table>
        <caption>{data.name}</caption>
        <thead><tr>{data.headings.map((heading, index) => <th key={index} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{active.map(({ id, values }, index) => <tr key={id} tabIndex={0}
          onFocus={() => setFocused(`Focused row ${start + index + 1}, ${values[0]}.`)}>
          {values.map((value, column) => <td key={column}>{value}</td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <div className="dialog-actions">
      <button type="button" className="button quiet" disabled={!page} onClick={() => { setPage(page - 1); setFocused(""); }}>Previous rows</button>
      <button type="button" className="button quiet" disabled={start + pageSize >= rows.length}
        onClick={() => { setPage(page + 1); setFocused(""); }}>Next rows</button>
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

export function chartHtml(title: string, svg: string, description: string, values: ChartProjection) {
  const { headings, rows } = displayedChartTable(values);
  const heading = headings.map(value => `<th scope="col">${escapeText(value)}</th>`).join("");
  const pages = [];
  for (let start = 0; start < rows.length; start += pageSize) {
    const entries = rows.slice(start, start + pageSize);
    const label = `Rows ${start + 1}–${start + entries.length} of ${rows.length}`;
    const body = entries.map(({ values }) => `<tr>${values.map(value => `<td>${escapeText(value)}</td>`).join("")}</tr>`).join("");
    pages.push(`<details${start === 0 ? " open" : ""}><summary>${label}</summary><div class="table"><table><caption>Displayed values, ${label}</caption><thead><tr>${heading}</tr></thead><tbody>${body}</tbody></table></div></details>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeText(title)} · Meridian</title><style>body{font:16px/1.55 system-ui,sans-serif;margin:0;padding:1rem;background:#f7f8fb;color:#172131}main{max-width:58rem;margin:auto}svg{width:100%;height:auto;display:block}details{margin:.65rem 0;padding:.65rem;background:#fff;border:1px solid #ccd2df;border-radius:.45rem}summary{cursor:pointer;font-weight:600}.table{overflow:auto}table{width:100%;border-collapse:collapse;min-width:24rem}th,td{text-align:left;border-bottom:1px solid #d9dee9;padding:.5rem}caption{text-align:left;padding:.5rem 0}</style></head>
<body><main><h1>${escapeText(title)}</h1>${svg}<p>${escapeText(description)}</p><h2>Displayed values</h2>${pages.join("") || "<p>No displayed values.</p>"}</main></body></html>`;
}
