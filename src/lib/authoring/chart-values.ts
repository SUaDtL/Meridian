import { compareChartCells, convertChartCell, validateChartDataset, type ChartCell, type ChartField, type ChartProject } from './chart-data';
import { aggregateChartValues, chartValue, type ChartValue } from './chart-numbers';

type PresentCell = Exclude<ChartCell, null>;
type Observation = {
  rowIds: string[];
  x: ChartCell;
  series: ChartCell;
  y: ChartValue | null;
  numericX: ChartValue | null;
  countValues: number;
  outside: boolean;
  overlap: number;
};

function isCategory(field: ChartField | undefined) {
  return field?.type === 'string' || field?.type === 'date' || field?.type === 'boolean';
}

function checkedDomain(domain: string[] | null, type: ChartField['type'], axis: string) {
  if (!domain) return null;
  if (domain.length !== 2 || domain.some(value => convertChartCell(value, type) !== value)
    || compareChartCells(domain[0], domain[1], type) >= 0) {
    throw new Error(`Choose an ordered, valid ${axis} domain.`);
  }
  return domain as [string, string];
}

function exactCompare(a: ChartValue, b: ChartValue) {
  const difference = a.exact.numerator * b.exact.denominator - b.exact.numerator * a.exact.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function outsideNumeric(value: ChartValue | null, limits: [ChartValue, ChartValue] | null) {
  return !!(value && limits && (exactCompare(value, limits[0]) < 0 || exactCompare(value, limits[1]) > 0));
}

function numericBounds(domain: [string, string] | null): [ChartValue, ChartValue] | null {
  return domain && [chartValue(domain[0]), chartValue(domain[1])];
}

function filterRows(project: ChartProject, index: ReadonlyMap<string, number>) {
  const { dataset, chartSpec: { filters } } = project;
  const tests = filters.map(({ fieldId, operator, value }) => {
    const column = index.get(fieldId);
    if (column === undefined) throw new Error('A filter refers to a missing field.');
    const { type } = dataset.fields[column];
    if (operator === 'isNull' || operator === 'isNotNull') {
      if (value !== null) throw new Error('A missing-value filter needs an empty comparison value.');
      return (cells: ChartCell[]) => operator === 'isNull' ? cells[column] === null : cells[column] !== null;
    }
    if (value === null || convertChartCell(value, type) !== value) throw new Error('Use a comparison value that matches the filter field.');
    if (operator !== 'eq' && operator !== 'ne' && (type === 'string' || type === 'boolean')) {
      throw new Error('This field supports only equality and missing-value filters.');
    }
    return (cells: ChartCell[]) => {
      const cell = cells[column];
      if (cell === null) return false;
      const relation = compareChartCells(cell, value, type);
      switch (operator) {
        case 'eq': return relation === 0;
        case 'ne': return relation !== 0;
        case 'lt': return relation < 0;
        case 'lte': return relation <= 0;
        case 'gt': return relation > 0;
        case 'gte': return relation >= 0;
      }
    };
  });
  const exclusions: Record<string, number> = Object.create(null);
  const rows = dataset.rows.filter(row => {
    const rejectedBy = tests.findIndex(test => !test(row.cells));
    if (rejectedBy === -1) return true;
    exclusions[row.id] = rejectedBy + 1;
    return false;
  });
  return { rows, exclusions };
}

/** Derive exact observations from an accepted typed dataset and closed mapping. */
export function projectChartValues(project: ChartProject) {
  const dataset = validateChartDataset(project.dataset);
  const { chartSpec: spec } = project;
  const fields = new Map(dataset.fields.map((field, position) => [field.id, position]));
  const xIndex = fields.get(spec.xField);
  const yIndex = spec.yField === null ? undefined : fields.get(spec.yField);
  const seriesIndex = spec.seriesField === null ? undefined : fields.get(spec.seriesField);
  const x = xIndex === undefined ? undefined : dataset.fields[xIndex];
  const y = yIndex === undefined ? undefined : dataset.fields[yIndex];
  const series = seriesIndex === undefined ? undefined : dataset.fields[seriesIndex];
  const aggregates = spec.aggregation !== 'none';
  const counting = spec.aggregation === 'countRows' || spec.aggregation === 'countValues';
  if (!x || xIndex === undefined || (spec.aggregation === 'countRows' ? spec.yField !== null : y?.type !== 'number')
    || (spec.seriesField !== null && !isCategory(series))) {
    throw new Error('Choose fields that match the chart mapping.');
  }
  if (spec.connectMissing || (spec.unitScale.x && (x.type !== 'number' || spec.mark === 'bar'))
    || (spec.unitScale.y && counting)) throw new Error('This chart cannot use the chosen scaling or missing-value options.');
  if (spec.mark === 'bar') {
    if (!isCategory(x) || spec.xDomain || spec.missing !== 'exclude'
      || (aggregates ? spec.duplicateX !== 'aggregate' : spec.duplicateX === 'aggregate')) {
      throw new Error('Choose a category field and a supported duplicate policy for the bar chart.');
    }
  } else if (spec.mark === 'line') {
    if (!['number', 'date', 'datetime'].includes(x.type) || spec.ordering !== 'ascending' || spec.missing !== 'gap'
      || spec.duplicateX !== (aggregates ? 'aggregate' : 'reject')) throw new Error('Choose a numeric or time X field and the line-chart ordering and duplicate policy.');
  } else if (x.type !== 'number' || spec.ordering !== 'source' || spec.missing !== 'exclude' || aggregates
    || spec.duplicateX !== 'keep-separate') throw new Error('Choose numeric X and Y fields for an unaggregated scatter chart.');
  const xDomain = checkedDomain(spec.xDomain, x.type, 'X');
  const yDomain = checkedDomain(spec.yDomain, 'number', 'Y');
  const xLimits = x.type === 'number' ? numericBounds(xDomain) : null;
  const yLimits = numericBounds(yDomain);
  const { rows, exclusions } = filterRows(project, fields);
  type CellGroup = { x: ChartCell; series: ChartCell; ids: string[]; values: (string | null)[] };
  const grouped = new Map<string, CellGroup>();
  const seriesKeys = new Set<ChartCell>();
  const duplicates = new Set<string>();
  let excludedMissing = 0;
  let nullX = 0;
  let nullY = 0;
  for (const row of rows) {
    const xCell = row.cells[xIndex];
    const yCell = yIndex === undefined ? null : row.cells[yIndex] as string | null;
    const seriesCell = seriesIndex === undefined ? null : row.cells[seriesIndex];
    if (xCell === null) nullX++;
    if (yCell === null && yIndex !== undefined) nullY++;
    if ((xCell === null && (spec.mark !== 'bar' || spec.nullCategory === 'exclude'))
      || (seriesIndex !== undefined && seriesCell === null && spec.nullCategory === 'exclude')
      || (spec.mark === 'scatter' && yCell === null)) {
      excludedMissing++;
      continue;
    }
    seriesKeys.add(seriesCell);
    if (seriesKeys.size > 12) throw new Error('Display up to 12 series. Filter the data or choose another series field.');
    const key = JSON.stringify([seriesCell, xCell]);
    if (spec.duplicateX === 'reject' && duplicates.has(key)) throw new Error('Multiple rows share an X value in the same series. Choose an aggregation or change the mapping.');
    duplicates.add(key);
    const groupKey = aggregates ? key : row.id;
    const group = grouped.get(groupKey) ?? { x: xCell, series: seriesCell, ids: [], values: [] };
    group.ids.push(row.id);
    group.values.push(yCell);
    grouped.set(groupKey, group);
  }
  const limit = spec.mark === 'scatter' ? 2_000 : 500;
  if (grouped.size > limit) throw new Error(`This chart can display up to ${limit.toLocaleString('en-US')} observations. Filter or aggregate the data first.`);
  const observations: Observation[] = [];
  const overlap = new Map<string, Observation[]>();
  for (const group of grouped.values()) {
    const plotted = aggregates && spec.aggregation !== 'none'
      ? aggregateChartValues(group.values, spec.aggregation, spec.unitScale.y?.power10)
      : { countValues: group.values[0] === null ? 0 : 1, value: group.values[0] === null ? null : chartValue(group.values[0], spec.unitScale.y?.power10) };
    const numericX = x.type === 'number' && typeof group.x === 'string' ? chartValue(group.x, spec.unitScale.x?.power10) : null;
    const outside = outsideNumeric(numericX, xLimits) || outsideNumeric(plotted.value, yLimits)
      || (!!xDomain && !numericX && typeof group.x === 'string' && (group.x < xDomain[0] || group.x > xDomain[1]));
    const observation = { rowIds: group.ids, x: group.x, series: group.series, y: plotted.value,
      numericX, countValues: plotted.countValues, outside, overlap: 1 };
    observations.push(observation);
    if (spec.mark === 'scatter') {
      const key = JSON.stringify([group.x, group.values[0]]);
      const points = overlap.get(key) ?? [];
      points.push(observation);
      overlap.set(key, points);
    }
  }
  for (const points of overlap.values()) for (const point of points) point.overlap = points.length;
  if (spec.ordering !== 'source') {
    const direction = spec.ordering === 'ascending' ? 1 : -1;
    observations.sort((a, b) => {
      if (a.x === null || b.x === null) return a.x === b.x ? 0 : a.x === null ? 1 : -1;
      return direction * compareChartCells(a.x as PresentCell, b.x as PresentCell, x.type);
    });
  }
  return {
    unitScale: spec.unitScale,
    x, y, series, xDomain, yDomain, observations, seriesKeys: [...seriesKeys], filterExclusions: exclusions,
    counts: { input: dataset.rows.length, retained: rows.length, excludedMissing, nullX, nullY,
      outside: observations.filter(point => point.outside).length, plotted: observations.filter(point => point.y !== null).length },
  };
}
