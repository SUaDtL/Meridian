import { expect, test } from 'vitest';
import { confirmChartColumns, readChartInput, type ColumnConfirmation } from './chart-input';

test('converts only explicitly retained columns and preserves their original order', () => {
  const input = readChartInput('Label,Note,Quantity\nNorth,untyped,0.10\nSouth,other,0.20', ',');
  const column = (name: string, type: ColumnConfirmation['type']): ColumnConfirmation => ({ name, type, unit: '', emptyIsNull: false });
  const { dataset, conversions } = confirmChartColumns(input, [column('Label', 'string'), null, column('Quantity', 'number')]);
  expect(dataset.fields.map(({ name, type }) => [name, type])).toEqual([['Label', 'string'], ['Quantity', 'number']]);
  expect(dataset.rows.map(({ cells }) => cells)).toEqual([['North', '0.1'], ['South', '0.2']]);
  expect(conversions.map(({ fieldId }) => fieldId)).toEqual(dataset.fields.map(({ id }) => id));
  expect(() => confirmChartColumns(input, [null, null, null])).toThrow('Keep at least one column');
});
