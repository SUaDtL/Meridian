import { useState } from "react";
import { convertChartCell, type ChartDataset, type ChartFilter } from "../lib/authoring/chart-data";

const operators = {
  eq: "Equals", ne: "Does not equal", lt: "Less than", lte: "At most", gt: "Greater than", gte: "At least",
  isNull: "Is missing", isNotNull: "Is present",
} satisfies Record<ChartFilter["operator"], string>;
const general = ["eq", "ne", "isNull", "isNotNull"] as const;
const ordered = ["lt", "lte", "gt", "gte"] as const;

export default function ChartFilterEditor({ dataset, filters, disabled, onChange }: {
  dataset: ChartDataset;
  filters: ChartFilter[];
  disabled: boolean;
  onChange: (filters: ChartFilter[]) => void;
}) {
  const [fieldId, setFieldId] = useState("");
  const [operator, setOperator] = useState<ChartFilter["operator"]>("eq");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const field = dataset.fields.find(item => item.id === fieldId);
  const missing = operator === "isNull" || operator === "isNotNull";
  const canOrder = field?.type === "number" || field?.type === "date" || field?.type === "datetime";
  const choices = canOrder ? [...general, ...ordered] : general;

  function addFilter() {
    if (!field || filters.length >= 20) return;
    try {
      const criterion = missing ? null : convertChartCell(value, field.type);
      onChange([...filters, { fieldId: field.id, operator, value: criterion }]);
      setValue("");
      setError("");
    } catch (reason) {
      const message = reason instanceof Error && !reason.message.startsWith("CHART_")
        ? reason.message : "Enter a supported decimal with a period as the decimal separator.";
      setError(message);
    }
  }

  return <details>
    <summary>Data filters ({filters.length})</summary>
    <fieldset className="guided-process-fieldset" disabled={disabled}>
      <legend>Filter retained rows</legend>
      {filters.length > 0 && <ol>
        {filters.map((filter, index) => <li key={index}>
          <p>{dataset.fields.find(item => item.id === filter.fieldId)?.name || "Unavailable field"} · {operators[filter.operator]}{filter.value !== null && ` · ${String(filter.value) || "(empty text)"}`}</p>
          <button type="button" className="button quiet" onClick={() => onChange(filters.filter((_, position) => index !== position))}
            aria-label={`Remove filter ${index + 1}`}>Remove filter</button>
        </li>)}
      </ol>}
      {filters.length >= 20 ? <p>Up to 20 filters can be applied together.</p> : <>
        <div className="chart-map">
          <label>Filter column<select value={fieldId} onChange={event => {
            setFieldId(event.target.value); setOperator("eq"); setValue(""); setError("");
          }}><option value="">Choose a field</option>
            {dataset.fields.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          <label>Filter comparison<select value={operator} disabled={!field} onChange={event => {
            setOperator(event.target.value as ChartFilter["operator"]); setError("");
          }}>
            {choices.map(choice => <option key={choice} value={choice}>{operators[choice]}</option>)}
          </select></label>
          {field && !missing && <label>Filter value
            {field.type === "boolean" ? <select value={value} onChange={event => { setValue(event.target.value); setError(""); }}>
              <option value="">Choose a value</option><option value="true">True</option><option value="false">False</option>
            </select> : <input maxLength={2000} value={value} inputMode={field.type === "number" ? "decimal" : "text"}
              onChange={event => { setValue(event.target.value); setError(""); }} />}
          </label>}
        </div>
        {error && <p role="alert">{error}</p>}
        <button type="button" className="button secondary" disabled={!field || (!missing && field.type !== "string" && !value)}
          onClick={addFilter}>Add filter</button>
      </>}
      <p className="muted-note">Meridian keeps rows that satisfy every filter. The complete typed table stays in the project.</p>
    </fieldset>
  </details>;
}
