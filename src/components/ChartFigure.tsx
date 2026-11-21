import { useId, type Ref } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import { line } from "d3-shape";
import { getTheme } from "../lib/themes";
import type { ChartCell, ChartProject } from "../lib/authoring/chart-data";
import type { ChartValue } from "../lib/authoring/chart-numbers";
import type { projectChartValues } from "../lib/authoring/chart-values";

export type ChartProjection = ReturnType<typeof projectChartValues>;
type Observation = ChartProjection["observations"][number];
const dimensions = { auto: [820, 500], "16:9": [896, 504], "4:3": [760, 570], "1:1": [680, 680] };
const formatTick = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 5 });
const groupingKey = (value: ChartCell) => JSON.stringify(value);
const geometricNumber = ({ exact }: ChartValue) => Number(exact.numerator) / Number(exact.denominator);
const countLabel = (count: number, singular: string) => `${count} ${singular}${count === 1 ? "" : "s"}`;

export function chartCategory(value: ChartCell) { return value === null ? "Missing category" : String(value); }

function numericDomain(values: number[], zero: boolean, singleUnit?: number): [number, number] {
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (zero) {
    if (!low && !high) return [0, 1];
    return [Math.min(0, low), Math.max(0, high)];
  }
  const padding = low === high ? singleUnit ?? Math.max(1, Math.abs(low) * 0.05) : (high - low) * 0.05;
  return [low - padding, high + padding];
}

function truncate(text: string, limit: number) {
  const characters = [...text];
  return characters.length <= limit ? text : characters.slice(0, limit - 1).join("") + "…";
}

export function describeChart(project: ChartProject, values: ChartProjection) {
  const { chartSpec: spec } = project;
  const label = (name: string, unit?: string) => unit ? `${name} (${unit})` : name;
  const y = spec.aggregation === "countRows" ? "Row count"
    : spec.aggregation === "countValues" ? `Present values of ${values.y?.name || "Y"}` : values.y?.name || "Value";
  const aggregation = spec.aggregation === "countRows" ? "row count" : spec.aggregation === "countValues" ? "present-value count" : spec.aggregation;
  const xText = label(values.x.name, spec.unitScale.x?.unitLabel || values.x.unit);
  const yText = label(y, spec.aggregation === "countRows" || spec.aggregation === "countValues" ? undefined : spec.unitScale.y?.unitLabel || values.y?.unit);
  const parts = [
    `${spec.mark[0].toUpperCase() + spec.mark.slice(1)} chart of ${yText} by ${xText}.`,
    values.series ? `Series by ${values.series.name}.` : "",
    spec.aggregation === "none" ? "" : `Aggregation is ${aggregation}.`,
    spec.mark === "bar" && !values.yDomain ? "The bar axis includes zero." : "",
    values.yDomain ? `Y domain ${values.yDomain.join(" to ")}.` : "",
    values.xDomain ? `X domain ${values.xDomain.join(" to ")}.` : "",
    spec.unitScale.x ? `X values are multiplied by 10^${spec.unitScale.x.power10}.` : "",
    spec.unitScale.y ? `Y values are multiplied by 10^${spec.unitScale.y.power10}.` : "",
    `${countLabel(values.counts.plotted, "observation")} from ${countLabel(values.counts.retained, "retained row")} of ${countLabel(values.counts.input, "input row")}.`,
    spec.filters.length ? `Rows excluded by filters: ${values.counts.input - values.counts.retained}.` : "",
    values.counts.excludedMissing ? `Rows excluded for missing values: ${values.counts.excludedMissing}.` : "",
    values.counts.outside ? `Observations outside the chart range: ${values.counts.outside}.` : "",
    values.counts.nullY ? `Rows with missing Y values: ${values.counts.nullY}.` : "",
    values.counts.overlappingPoints ? `${countLabel(values.counts.overlappingPoints, "point")} share ${countLabel(values.counts.overlapPositions, "position")} in the plot.` : "",
    values.observations.some(point => point.y?.approximate || point.numericX?.approximate) ? "Some displayed values are rounded. The exact fractions are available in the displayed values table." : "",
  ];
  return { xText, yText, description: [...parts.filter(Boolean), spec.description].filter(Boolean).join(" ") };
}

export default function ChartFigure({ project, values, svgRef }: { project: ChartProject; values: ChartProjection; svgRef?: Ref<SVGSVGElement> }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const heading = `chart-heading-${uid}`;
  const details = `chart-details-${uid}`;
  const clip = `chart-clip-${uid}`;
  const { chartSpec: spec, frame } = project;
  const theme = getTheme(frame.theme);
  const [baseWidth, baseHeight] = dimensions[frame.frame];
  const padding = frame.padding;
  const scale = Math.max(1, (2 * padding + 320) / baseHeight);
  const width = baseWidth * scale;
  const height = baseHeight * scale;
  const left = padding + 57;
  const right = width - padding;
  const top = frame.showTitle ? padding + (project.subtitle ? 74 : 56) : padding + 20;
  const bottom = height - padding - (values.series ? 85 : 58);
  const observations = values.observations;
  const visible = observations.filter(point => point.y !== null);
  const empty = !visible.length;
  const isBar = spec.mark === "bar";
  const isTime = values.x.type === "date" || values.x.type === "datetime";
  const { xText, yText, description } = describeChart(project, values);
  const truncated = isBar && values.yDomain && (Number(values.yDomain[0]) > 0 || Number(values.yDomain[1]) < 0);
  const rangeNote = [truncated ? "Truncated Y axis" : "", values.counts.outside ? `${values.counts.outside} outside range` : ""].filter(Boolean).join(" · ");
  const plotNote = [rangeNote, values.counts.overlappingPoints ? `${values.counts.overlappingPoints} overlapping points` : ""].filter(Boolean).join(" · ");
  const xNumber = (point: Observation) => point.numericX ? geometricNumber(point.numericX) : Date.parse(String(point.x));
  const yNumber = (point: Observation) => point.y ? geometricNumber(point.y) : 0;
  const endpoint = (value: string) => isTime ? Date.parse(value) : Number(value);
  const xLinear = scaleLinear().domain(values.xDomain?.map(endpoint) ?? (!isBar && !empty
    ? numericDomain(observations.map(xNumber), false, isTime ? values.x.type === "date" ? 86_400_000 : 3_600_000 : undefined) : [0, 1]))
    .range([left, right]);
  const yLinear = scaleLinear().domain(values.yDomain?.map(Number) ?? (!empty ? numericDomain(visible.map(yNumber), isBar) : [0, 1]))
    .range([bottom, top]);
  const orderedBars = new Map<string, Observation[]>();
  const series = new Map<ChartCell, Observation[]>(values.seriesKeys.map(key => [key, []]));
  for (const observation of observations) {
    series.get(observation.series)?.push(observation);
    if (isBar) {
      const key = groupingKey(observation.x);
      const bars = orderedBars.get(key) ?? [];
      bars.push(observation);
      orderedBars.set(key, bars);
    }
  }
  const xBand = scaleBand().domain([...orderedBars.keys()]).range([left, right]).padding(0.23);
  const yBase = yLinear(truncated ? Number(values.yDomain?.[0]) > 0 ? Number(values.yDomain?.[0]) : Number(values.yDomain?.[1]) : 0);
  const xLabels = [...orderedBars].filter((_, index) => index % Math.max(1, Math.ceil(orderedBars.size / 8)) === 0);
  const seriesIndex = new Map(values.seriesKeys.map((key, index) => [key, index]));
  const color = (key: ChartCell) => theme.palette[(seriesIndex.get(key) ?? 0) % theme.palette.length];
  const connection = line<Observation>().defined(point => point.y !== null).x(point => xLinear(xNumber(point))).y(point => yLinear(yNumber(point)));
  const tickText = (value: number) => isTime
    ? new Date(value).toISOString().slice(0, values.x.type === "date" ? 10 : 16).replace("T", " ")
    : formatTick.format(value);
  const xTicks = !isBar && isTime
    ? [xLinear.domain()[0], (xLinear.domain()[0] + xLinear.domain()[1]) / 2, xLinear.domain()[1]]
    : xLinear.ticks(6);
  return <svg ref={svgRef} className="chart-figure" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${width} ${height}`}
    role="img" aria-labelledby={heading} aria-describedby={details} fontFamily="system-ui, sans-serif" fill={theme.text}>
    <title id={heading}>{project.title || "Chart"}</title>
    <desc id={details}>{description} {rangeNote} {empty ? "There are no plottable observations." : ""}</desc>
    <rect width={width} height={height} rx="18" fill={theme.canvas} />
    <defs><clipPath id={clip}><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
    {frame.showTitle && <text x={padding} y={padding + 25} fontSize="24" fontWeight="700">{truncate(project.title || "Untitled chart", 46)}</text>}
    {frame.showTitle && project.subtitle && <text x={padding} y={padding + 47} fontSize="14" fill={theme.muted}>{truncate(project.subtitle, 70)}</text>}
    {empty ? <text x={width / 2} y={height / 2} textAnchor="middle" fontSize="16">No plottable observations</text> : <>
      {yLinear.ticks(5).map(tick => <g key={tick} transform={`translate(0 ${yLinear(tick)})`}>
        <path d={`M${left} 0H${right}`} stroke={theme.border} />
        <text x={left - 10} textAnchor="end" dominantBaseline="middle" fontSize="11">{formatTick.format(tick)}</text>
      </g>)}
      <path d={`M${left} ${top}V${bottom}H${right}`} fill="none" stroke={theme.text} />
      <g clipPath={`url(#${clip})`}>
        {isBar && [...orderedBars].map(([key, points]) => {
          const barWidth = xBand.bandwidth() / points.length;
          return points.map((point, index) => point.y && <rect key={point.rowIds[0]}
            x={(xBand(key) ?? left) + index * barWidth} y={Math.min(yBase, yLinear(yNumber(point)))}
            width={barWidth * 0.88} height={Math.abs(yBase - yLinear(yNumber(point)))} fill={color(point.series)} />);
        })}
        {spec.mark === "line" && [...series].map(([key, points]) => <path key={groupingKey(key)}
          d={connection(points) || undefined} fill="none" stroke={color(key)} strokeWidth="2.5" />)}
        {!isBar && visible.map(point => <circle key={point.rowIds[0]} cx={xLinear(xNumber(point))}
          cy={yLinear(yNumber(point))} r={spec.mark === "scatter" ? 3.7 : 3} fill={color(point.series)} />)}
      </g>
      <g fontSize="11" textAnchor="middle">
        {isBar ? xLabels.map(([key, points]) => <text key={key} x={(xBand(key) ?? left) + xBand.bandwidth() / 2}
          y={bottom + 17}>{truncate(chartCategory(points[0].x), 14)}</text>)
          : xTicks.map(tick => <text key={tick} x={xLinear(tick)} y={bottom + 17}>{tickText(tick)}</text>)}
      </g>
      <text x={(left + right) / 2} y={bottom + 37} fontSize="13" textAnchor="middle">{truncate(xText, 50)}</text>
      <text transform={`translate(${padding + 13} ${(top + bottom) / 2}) rotate(-90)`}
        fontSize="13" textAnchor="middle">{truncate(yText, 39)}</text>
      {values.series && values.seriesKeys.map((key, index) => {
        const step = (right - left) / Math.min(6, values.seriesKeys.length);
        const x = left + (index % 6) * step;
        const y = bottom + 56 + Math.floor(index / 6) * 17;
        return <g key={groupingKey(key)}><rect x={x} y={y - 9} width="8" height="8" rx="2" fill={color(key)} />
          <text x={x + 12} y={y - 2} fontSize="10">{truncate(chartCategory(key), 12)}</text></g>;
      })}
    </>}
    {plotNote && <text x={padding} y={height - 13} fontSize="11" fill={theme.text}>{plotNote}</text>}
    {frame.showBrand && <text x={right} y={height - 13} textAnchor="end" fontSize="11" fill={theme.muted}>Meridian</text>}
  </svg>;
}
