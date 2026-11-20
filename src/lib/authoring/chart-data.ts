import { canonicalChartNumber, compareChartNumbers } from './chart-numbers';
import type { StudioSettings } from '../../types';

export type FieldType = 'string' | 'number' | 'date' | 'datetime' | 'boolean';
export type ChartCell = string | boolean | null;
export type ChartField = { id: string; name: string; type: FieldType; unit: string };
export type ChartRow = { id: string; cells: ChartCell[] };
export type ChartDataset = { version: 1; fields: ChartField[]; rows: ChartRow[] };
export type ChartScale = { power10: number; unitLabel: string };
export type ChartFilter = { fieldId: string; operator: 'isNull' | 'isNotNull' | 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte'; value: ChartCell };

export type ChartSpec = {
  version: 1;
  mark: 'bar' | 'line' | 'scatter';
  xField: string;
  yField: string | null;
  seriesField: string | null;
  aggregation: 'none' | 'sum' | 'mean' | 'min' | 'max' | 'countRows' | 'countValues';
  ordering: 'ascending' | 'descending' | 'source';
  missing: 'gap' | 'exclude';
  nullCategory: 'exclude' | 'separate';
  duplicateX: 'reject' | 'aggregate' | 'keep-separate';
  connectMissing: boolean;
  xDomain: string[] | null;
  yDomain: string[] | null;
  filters: ChartFilter[];
  unitScale: { x: ChartScale | null; y: ChartScale | null };
  showClippingAnnotation: true;
  description: string;
};

export type ChartProject = {
  schema: 'meridian-chart/v1';
  documentKind: 'chart';
  id: string;
  revision: number;
  title: string;
  subtitle: string;
  updatedAt: string;
  dataset: ChartDataset;
  chartSpec: ChartSpec;
  frame: Pick<StudioSettings, 'theme' | 'frame' | 'padding' | 'showTitle' | 'showBrand'>;
};

export const chartDataLimits = Object.freeze({ bytes: 2_000_000, rows: 10_000, fields: 100, cells: 100_000, datasetBytes: 1_500_000 });
const encoder = new TextEncoder();
const calendarDate = /^(\d{4})-(\d\d)-(\d\d)$/;
const offsetTime = /^(\d{4}-\d\d-\d\d)T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.(\d+))?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const unpairedSurrogate = /[\uD800-\uDFFF]/u;

function canonicalDate(value: string) {
  const parts = calendarDate.exec(value);
  if (!parts || parts[0] !== value) throw new Error('Use a valid date in YYYY-MM-DD form.');
  const [, year, month, day] = parts.map(Number);
  const lastDay = new Date(0);
  lastDay.setUTCFullYear(year, month, 0);
  if (month < 1 || month > 12 || day < 1 || day > lastDay.getUTCDate()) throw new Error('Use a valid calendar date.');
  return value;
}

export function convertChartCell(value: ChartCell, type: FieldType): ChartCell {
  if (value === null) return null;
  if (type === 'boolean') {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    throw new Error('Use true or false for a Boolean value.');
  }
  if (typeof value !== 'string' || unpairedSurrogate.test(value)) throw new Error('Use well-formed text for this value.');
  if (type === 'number') return canonicalChartNumber(value);
  if (type === 'date') return canonicalDate(value);
  if (type === 'datetime') {
    const parts = offsetTime.exec(value);
    if (!parts || parts[0] !== value) throw new Error('Use an ISO timestamp with Z or an explicit UTC offset.');
    canonicalDate(parts[1]);
    if (parts[2]?.slice(3).match(/[1-9]/)) throw new Error('Timestamp precision must be milliseconds or less.');
    const instant = Date.parse(value);
    if (!Number.isFinite(instant)) throw new Error('Use a valid ISO timestamp.');
    const normalized = new Date(instant).toISOString();
    if (!/^\d{4}-/.test(normalized)) throw new Error('The UTC timestamp is outside the supported years.');
    return normalized;
  }
  if ([...value].length > 2_000) throw new Error('A text cell can contain up to 2,000 characters.');
  return value;
}

/** Validate typed cells after the closed portable schema verifies the document shape. */
export function validateChartDataset(dataset: ChartDataset) {
  const { fields, rows } = dataset;
  if (!fields.length || fields.length > chartDataLimits.fields || rows.length > chartDataLimits.rows
    || fields.length * rows.length > chartDataLimits.cells) throw new Error('This dataset exceeds the row, column, or cell limit.');
  if (new Set(fields.map(field => field.name)).size !== fields.length
    || new Set(fields.map(field => field.id)).size !== fields.length) throw new Error('Each dataset column needs a unique name and ID.');
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Each row needs a distinct ID.');
  for (const [rowIndex, { cells }] of rows.entries()) {
    if (cells.length !== fields.length) throw new Error(`Row ${rowIndex + 1} does not match the confirmed columns.`);
    for (const [index, value] of cells.entries()) {
      try {
        if (convertChartCell(value, fields[index].type) !== value) throw new Error('Value is not canonical.');
      } catch {
        throw new Error(`Row ${rowIndex + 1}, column “${fields[index].name}” does not contain an accepted ${fields[index].type} value.`);
      }
    }
  }
  if (encoder.encode(JSON.stringify(dataset)).byteLength > chartDataLimits.datasetBytes) {
    throw new Error('The confirmed dataset exceeds 1,500,000 bytes. Keep fewer rows or columns.');
  }
  return dataset;
}

export function compareChartCells(a: Exclude<ChartCell, null>, b: Exclude<ChartCell, null>, type: FieldType) {
  if (type === 'number') return compareChartNumbers(a as string, b as string);
  return a < b ? -1 : a > b ? 1 : 0;
}
