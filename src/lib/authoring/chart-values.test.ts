import { describe, expect, it } from 'vitest';
import { convertChartCell, type ChartProject } from './chart-data';
import { confirmChartColumns, readChartInput } from './chart-input';
import { aggregateChartValues, canonicalChartNumber, localizedChartNumber } from './chart-numbers';
import { parseChartProject, validateChartProject } from './chart-project';
import fixture from './fixtures/example-chart.json';

describe('exact chart values', () => {
  it('normalizes only confirmed numeric locale separators', () => {
    expect(localizedChartNumber('-1.234,500e-2', { decimal: 'comma', grouping: 'period' })).toBe('-12.345');
    expect(localizedChartNumber('1\u202F234,50', { decimal: 'comma', grouping: 'space' })).toBe('1234.5');
    expect(localizedChartNumber('1,234.00', { decimal: 'period', grouping: 'comma' })).toBe('1234');
    expect(() => localizedChartNumber('1.23,40', { decimal: 'comma', grouping: 'period' })).toThrow('CHART_NUMBER_SYNTAX');
    expect(() => localizedChartNumber('1.2', { decimal: 'comma', grouping: 'none' })).toThrow('CHART_NUMBER_SYNTAX');
    expect(() => localizedChartNumber('1,1', { decimal: 'comma', grouping: 'comma' })).toThrow('CHART_NUMBER_SYNTAX');
    const input = readChartInput('[{"Value":1.234}]', 'json');
    expect(() => confirmChartColumns(input, [{ name: 'Value', type: 'number', unit: '', emptyIsNull: false,
      numeric: { decimal: 'comma', grouping: 'period' } }])).toThrow('JSON records use a decimal point');
  });

  it('normalizes decimal lexemes and retains the distinct row and value counts', () => {
    for (const [input, expected] of [['1.2300', '1.23'], ['-0', '0'], ['1e-3', '0.001'], ['+001.20', '1.2'], ['.5', '0.5'], ['1.', '1'], ['1e15', '1000000000000000']]) {
      expect(canonicalChartNumber(input)).toBe(expected);
    }
    for (const input of ['9007199254740993', '1234567890123456', '0.0000000000001', '1e1001', 'NaN', 'Infinity', '1,000', '1\n']) {
      expect(() => canonicalChartNumber(input)).toThrow();
    }
    const values = ['0.1', '0.2', null];
    expect(aggregateChartValues(values, 'sum')).toEqual({
      value: { display: '0.3', exact: { numerator: 3n, denominator: 10n }, approximate: false }, countRows: 3, countValues: 2,
    });
    expect(aggregateChartValues(values, 'mean').value?.display).toBe('0.15');
    expect(aggregateChartValues(values, 'countRows').value?.display).toBe('3');
    expect(aggregateChartValues(values, 'countValues').value?.display).toBe('2');
    for (const method of ['sum', 'mean', 'min', 'max'] as const) expect(aggregateChartValues([null, null], method).value).toBeNull();
  });

  it('tracks rational means, half-even rounding and explicit scaling', () => {
    expect(aggregateChartValues(['0', '0', '1'], 'mean').value).toEqual({
      display: '0.333333333333', exact: { numerator: 1n, denominator: 3n }, approximate: true,
    });
    expect(aggregateChartValues(['0', '1e-12'], 'mean').value).toMatchObject({ display: '0', approximate: true });
    expect(aggregateChartValues(['-1e-12', '-2e-12'], 'mean').value).toMatchObject({ display: '-0.000000000002', approximate: true });
    expect(() => aggregateChartValues(['5e15', '5e15'], 'sum')).toThrow('CHART_RANGE_UNSUPPORTED');
    expect(aggregateChartValues(['5e15', '5e15'], 'sum', -3).value?.display).toBe('10000000000000');
  });

  it('confirms local table types without rounding JSON or guessing calendar dates', () => {
    const definition = [{ name: 'Amount', type: 'number', unit: '', emptyIsNull: false }] as const;
    const unsafe = readChartInput('[{"Amount":9007199254740993}]', 'json');
    expect(unsafe.rows[0].cells).toEqual(['9007199254740993']);
    expect(() => confirmChartColumns(unsafe, [...definition])).toThrow('exact decimal');
    expect(confirmChartColumns(unsafe, [{ ...definition[0], type: 'string' }]).rows[0].cells).toEqual(['9007199254740993']);
    expect(() => readChartInput('[{"Amount":1,"Amount":2}]', 'json')).toThrow('repeated object key');
    expect(readChartInput('Name;Amount\n"South; West";1.200\n', ';').rows[0].cells).toEqual(['South; West', '1.200']);
    expect(convertChartCell('2024-02-29', 'date')).toBe('2024-02-29');
    expect(() => convertChartCell('2025-02-29', 'date')).toThrow();
    expect(convertChartCell('2024-02-29T23:15:00.0000-02:00', 'datetime')).toBe('2024-03-01T01:15:00.000Z');
    expect(() => convertChartCell('2024-01-01T00:00:00', 'datetime')).toThrow();
    expect(() => convertChartCell('2024-01-01T00:00:00.0001Z', 'datetime')).toThrow();
  });
});

describe('portable chart projection', () => {
  function project() {
    return structuredClone(fixture) as ChartProject;
  }

  it('round trips the design fixture and retains missing and out-of-range values', () => {
    const original = project();
    original.chartSpec.yDomain = ['0', '10'];
    const { project: parsed, projection } = parseChartProject(JSON.stringify(original));
    expect(parsed).toEqual(original);
    expect(projection.observations.map(point => [point.x, point.y?.display ?? null, point.outside]))
      .toEqual([['North', '12', true], ['South', null, false]]);
    expect(projection.counts).toMatchObject({ input: 2, outside: 1, nullY: 1, plotted: 1 });
    expect(() => validateChartProject({ ...parsed, source: 'flowchart LR' })).toThrow('chart format');
  });

  it('sorts a date line, rejects duplicate X and then aggregates each group with a null gap', () => {
    const original = project();
    original.dataset.fields[0].type = 'date';
    original.dataset.rows[0].cells = ['2024-01-03', null];
    original.dataset.rows[1].cells = ['2024-01-02', '0.1'];
    original.dataset.rows.push({ id: crypto.randomUUID(), cells: ['2024-01-01', '1'] },
      { id: crypto.randomUUID(), cells: ['2024-01-02', '0.2'] });
    Object.assign(original.chartSpec, { mark: 'line', missing: 'gap', ordering: 'ascending', duplicateX: 'reject' });
    expect(() => validateChartProject(original)).toThrow('share an X value');
    Object.assign(original.chartSpec, { aggregation: 'sum', duplicateX: 'aggregate' });
    const { projection } = validateChartProject(original);
    expect(projection.observations.map(point => [point.x, point.y?.display ?? null, point.countValues]))
      .toEqual([['2024-01-01', '1', 1], ['2024-01-02', '0.3', 2], ['2024-01-03', null, 0]]);
  });
});
