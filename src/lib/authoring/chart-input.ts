import { decodeJson } from './decode-json';
import { readDelimitedRows, type TableDelimiter } from './delimited-input';
import { chartDataLimits, convertChartCell, validateChartDataset, type ChartCell, type ChartDataset, type FieldType } from './chart-data';

export type ChartInputFormat = TableDelimiter | 'json';
export type ChartInput = { headings: string[]; rows: { line: number; cells: ChartCell[] }[] };
export type ColumnConfirmation = { name: string; type: FieldType; unit: string; emptyIsNull: boolean };
const encoder = new TextEncoder();

function checkSize(rows: number, columns: number) {
  if (!columns || columns > chartDataLimits.fields || rows > chartDataLimits.rows || rows * columns > chartDataLimits.cells) {
    throw new Error('Use at most 10,000 rows, 100 columns, and 100,000 cells.');
  }
}

function readObjects(text: string): ChartInput {
  const content = decodeJson(text, chartDataLimits.cells + chartDataLimits.rows + 1, 'text');
  if (!Array.isArray(content) || !content.length) throw new Error('Choose a JSON array of records.');
  const headings = new Set<string>();
  const records = content.map((row: unknown, index) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error(`Record ${index + 1} must be an object.`);
    for (const [name, value] of Object.entries(row)) {
      if (value !== null && typeof value !== 'string' && typeof value !== 'boolean') throw new Error(`Record ${index + 1} must contain only primitive field values.`);
      headings.add(name);
    }
    if (headings.size) checkSize(content.length, headings.size);
    return row as Record<string, ChartCell>;
  });
  checkSize(records.length, headings.size);
  const columns = [...headings];
  return { headings: columns, rows: records.map((record, index) =>
    ({ line: index + 1, cells: columns.map(name => Object.hasOwn(record, name) ? record[name] : null) })) };
}

export function readChartInput(text: string, format: ChartInputFormat): ChartInput {
  if (text.length > chartDataLimits.bytes || encoder.encode(text).byteLength > chartDataLimits.bytes) {
    throw new Error('Use a data file no larger than 2,000,000 bytes.');
  }
  if (format === 'json') return readObjects(text.replace(/^\uFEFF/, ''));
  const [header, ...rows] = readDelimitedRows(text, format, true);
  if (!header || !rows.length) throw new Error('Include a header row and at least one row of data.');
  checkSize(rows.length, header.cells.length);
  const invalid = rows.find(({ cells }) => cells.length !== header.cells.length);
  if (invalid) throw new Error(`Line ${invalid.line} has a different number of values than the heading row.`);
  return { headings: header.cells, rows };
}

function label(value: string, limit: number) {
  return !/[\uD800-\uDFFF]/u.test(value) && [...value].length <= limit;
}

export function confirmChartColumns(input: ChartInput, columns: ColumnConfirmation[]): ChartDataset {
  checkSize(input.rows.length, columns.length);
  if (input.headings.length !== columns.length) throw new Error('Confirm every column.');
  const names = columns.map(column => column.name.trim());
  if (names.some(name => !name || !label(name, 200)) || new Set(names).size !== names.length) {
    throw new Error('Give every column a unique name of 1 to 200 characters.');
  }
  if (columns.some(column => !label(column.unit, 80))) throw new Error('Choose unit labels of up to 80 characters.');
  const fields = columns.map(({ type, unit }, index) => ({ id: crypto.randomUUID(), name: names[index], type, unit }));
  const rows = input.rows.map(({ line, cells }) => ({
    id: crypto.randomUUID(),
    cells: cells.map((cell, index) => {
      const { type, emptyIsNull } = columns[index];
      const value = emptyIsNull && cell === '' ? null : cell;
      try {
        return convertChartCell(type === 'string' && typeof value === 'boolean' ? String(value) : value, type);
      } catch (reason) {
        const message = reason instanceof Error && !reason.message.startsWith('CHART_') ? reason.message : 'Use a supported exact decimal or retain the column as text.';
        throw new Error(`Input row ${line}, column “${names[index]}”. ${message}`);
      }
    }),
  }));
  return validateChartDataset({ version: 1, fields, rows });
}
