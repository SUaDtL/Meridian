import type { ChartScale } from "../lib/authoring/chart-data";

export default function ChartAxisScale({ axis, scale, onChange }: {
  axis: "X" | "Y";
  scale: ChartScale | null;
  onChange: (scale: ChartScale | null) => void;
}) {
  return <fieldset className="guided-process-fieldset">
    <legend>{axis} units</legend>
    <label className="check-label">
      <input type="checkbox" checked={scale !== null}
        onChange={event => onChange(event.target.checked ? { power10: 0, unitLabel: "" } : null)} />
      Scale {axis} values
    </label>
    {scale && <div className="chart-map">
      <label>{axis} multiplier
        <select value={scale.power10} onChange={event => onChange({ ...scale, power10: Number(event.target.value) })}>
          {Array.from({ length: 25 }, (_, index) => index - 12).map(power =>
            <option key={power} value={power}>× 10^{power}</option>)}
        </select>
      </label>
      <label>{axis} unit label
        <input value={scale.unitLabel} maxLength={80} onChange={event => onChange({ ...scale, unitLabel: event.target.value })} />
      </label>
    </div>}
  </fieldset>;
}
