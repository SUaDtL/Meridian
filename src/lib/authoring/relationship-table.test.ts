import { expect, test } from 'vitest';
import { readDelimitedRows } from './delimited-input';
import { mapRelationshipTable } from './relationship-table';

const mapping = { id: 0, label: 1, role: 2, source: 3, target: 4 };

test('reads quoted comma and tab fields, escaped quotes, embedded line breaks, and empty columns', () => {
  expect(readDelimitedRows('\uFEFFID,Label,Comment\r\n1,"A, B","line 1\r\nline 2"\r\n\r\n2,"She said ""go""",', ',')).toEqual([
    { line: 1, cells: ['ID', 'Label', 'Comment'] },
    { line: 2, cells: ['1', 'A, B', 'line 1\r\nline 2'] },
    { line: 5, cells: ['2', 'She said "go"', ''] },
  ]);
  expect(readDelimitedRows('"A\tB"\tC\t\n', '\t')).toEqual([{ line: 1, cells: ['A\tB', 'C', ''] }]);
});

test('rejects invalid quoting and bounded fields before mapping an input', () => {
  expect(() => readDelimitedRows('ID,Label\n1,"unclosed', ',')).toThrow(/Line 2, field 2: Close/);
  expect(() => readDelimitedRows('"closed" trailing,next', ',')).toThrow(/closing quote/);
  expect(() => readDelimitedRows('foo"bar,baz', ',')).toThrow(/Put quotes around the entire field/);
  expect(() => readDelimitedRows('x'.repeat(8_193), ',')).toThrow(/Shorten this table field/);
  expect(() => readDelimitedRows('x,'.repeat(100) + 'x', ',')).toThrow(/at most 100 columns/);
});

test('keeps duplicate visible system labels and maps relationships only through explicit IDs', () => {
  const table = readDelimitedRows('id,label,role,from,to\na,Service,service,,\nb,Service,database,,\n,=SUM(1),person,,\n,,,b,a', ',');
  expect(mapRelationshipTable(table, mapping, true)).toEqual({
    nodes: [
      { key: 'row-2', label: 'Service', role: 'service', sourceRow: 2 },
      { key: 'row-3', label: 'Service', role: 'database', sourceRow: 3 },
      { key: 'row-4', label: '=SUM(1)', role: 'person', sourceRow: 4 },
    ],
    edges: [{ from: 'row-3', to: 'row-2' }],
  });
  expect(() => mapRelationshipTable(readDelimitedRows('id,label,role,from,to\na,Service,,,\na,Service,,,', ','), mapping, true)).toThrow(/ID is already used/);
  expect(() => mapRelationshipTable(readDelimitedRows('id,label,role,from,to\na,Service,,a,unknown', ','), mapping, true)).toThrow(/endpoint does not match/);
  expect(() => mapRelationshipTable(table, { ...mapping, id: null }, true)).toThrow(/Map the node ID/);
});
