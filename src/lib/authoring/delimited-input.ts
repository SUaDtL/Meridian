export type TableDelimiter = ',' | '\t';

export type DelimitedRow = {
  line: number;
  cells: string[];
};

export const tableInputLimits = {
  bytes: 2_000_000,
  rows: 10_000,
  columns: 100,
  fieldCodeUnits: 8_192,
} as const;

export function readDelimitedRows(input: string, delimiter: TableDelimiter): DelimitedRow[] {
  if (delimiter !== ',' && delimiter !== '\t') throw new Error('Choose commas or tabs as the delimiter.');
  if (input.length > tableInputLimits.bytes || new TextEncoder().encode(input).byteLength > tableInputLimits.bytes) {
    throw new Error('Use a table no larger than 2,000,000 bytes.');
  }

  const rows: DelimitedRow[] = [];
  let cells: string[] = [];
  let field = '';
  let state: 'start' | 'literal' | 'quoted' | 'closed' = 'start';
  let line = 1;
  let rowStart = 1;
  let hasContent = false;

  function fail(message: string): never {
    throw new Error(`Line ${line}, field ${cells.length + 1}: ${message}`);
  }

  function append(text: string) {
    if (field.length + text.length > tableInputLimits.fieldCodeUnits) fail('Shorten this table field.');
    field += text;
  }

  function closeField() {
    if (cells.length === tableInputLimits.columns) fail('Use at most 100 columns.');
    cells.push(field);
    field = '';
    state = 'start';
  }

  function closeRow() {
    if (!hasContent) return;
    if (rows.length === tableInputLimits.rows) fail('Use at most 10,000 table rows.');
    closeField();
    rows.push({ line: rowStart, cells });
    cells = [];
    hasContent = false;
  }

  for (let index = input.charCodeAt(0) === 0xfeff ? 1 : 0; index < input.length; index++) {
    const char = input[index];
    const endOfLine = char === '\r' || char === '\n';
    if (state === 'quoted') {
      if (char === '"') {
        if (input[index + 1] === '"') {
          append('"');
          index++;
        } else state = 'closed';
      } else if (endOfLine) {
        if (char === '\r' && input[index + 1] === '\n') {
          append('\r\n');
          index++;
        } else append(char);
        line++;
      } else append(char);
      continue;
    }

    if (endOfLine) {
      closeRow();
      if (char === '\r' && input[index + 1] === '\n') index++;
      rowStart = ++line;
      continue;
    }
    hasContent = true;
    if (char === delimiter) closeField();
    else if (state === 'closed') fail('A closing quote must be followed by the delimiter or a line break.');
    else if (char === '"') {
      if (state !== 'start') fail('Put quotes around the entire field and double any literal quote.');
      state = 'quoted';
    } else {
      append(char);
      state = 'literal';
    }
  }

  if (state === 'quoted') fail('Close the quoted field before the end of the table.');
  closeRow();
  return rows;
}
