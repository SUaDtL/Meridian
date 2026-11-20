const renderMagnitude = 9_007_199_254_740_991n;
const decimalToken = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const displayPlaces = 12;

type Decimal = { coefficient: bigint; scale: number };
type Rational = { numerator: bigint; denominator: bigint };
export type NumericAggregate = 'sum' | 'mean' | 'min' | 'max' | 'countRows' | 'countValues';
export type NumberLocale = { decimal: 'period' | 'comma'; grouping: 'none' | 'period' | 'comma' | 'space' };
export interface ChartValue {
  exact: Rational;
  display: string;
  approximate: boolean;
}

function powerOfTen(exponent: number) {
  return 10n ** BigInt(exponent);
}

function absolute(value: bigint) {
  return value < 0n ? -value : value;
}

function formatDecimal(coefficient: bigint, scale: number) {
  if (!coefficient) return '0';
  const sign = coefficient < 0n ? '-' : '';
  const digits = absolute(coefficient).toString().padStart(scale + 1, '0');
  if (!scale) return sign + digits;
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return sign + (fraction ? `${whole}.${fraction}` : whole);
}

function parseDecimal(token: string): Decimal {
  if (token.length > 64 || !decimalToken.test(token) || token.trim() !== token) {
    throw new Error('CHART_NUMBER_SYNTAX');
  }
  const [mantissa, exponentText = '0'] = token.toLowerCase().split('e');
  const exponent = BigInt(exponentText);
  if (absolute(exponent) > 1000n) throw new Error('CHART_RANGE_UNSUPPORTED');
  const [whole, fraction = ''] = mantissa.replace(/^[+-]/, '').split('.');
  const digits = (whole + fraction).replace(/^0+/, '');
  if (!digits) return { coefficient: 0n, scale: 0 };
  const significant = digits.replace(/0+$/, '');
  const scale = fraction.length - Number(exponent) - (digits.length - significant.length);
  if (significant.length > 15 || scale > 12) throw new Error('CHART_PRECISION_UNSUPPORTED');
  if (significant.length - scale > 16) throw new Error('CHART_RANGE_UNSUPPORTED');
  const coefficient = BigInt(significant) * powerOfTen(Math.max(0, -scale));
  if (coefficient > renderMagnitude * powerOfTen(Math.max(0, scale))) throw new Error('CHART_RANGE_UNSUPPORTED');
  return { coefficient: mantissa.startsWith('-') ? -coefficient : coefficient, scale: Math.max(0, scale) };
}

export function canonicalChartNumber(token: string): string {
  const decimal = parseDecimal(token);
  return formatDecimal(decimal.coefficient, decimal.scale);
}

/** Interpret only user-confirmed decimal and grouping separators. */
export function localizedChartNumber(token: string, locale: NumberLocale) {
  if (token.length > 64 || token.trim() !== token) throw new Error('CHART_NUMBER_SYNTAX');
  const decimal = locale.decimal === 'comma' ? ',' : '.';
  const grouping = { none: '', period: '.', comma: ',', space: ' ' }[locale.grouping];
  if (decimal === grouping) throw new Error('CHART_NUMBER_SYNTAX');
  const exponentIndex = token.search(/[eE]/);
  const exponent = exponentIndex >= 0 ? token.slice(exponentIndex) : '';
  if (exponent && !/^[eE][+-]?\d+$/.test(exponent)) throw new Error('CHART_NUMBER_SYNTAX');
  const sign = /^[+-]/.test(token) ? token[0] : '';
  const number = token.slice(sign.length, exponentIndex < 0 ? undefined : exponentIndex);
  const [whole, fraction, extra] = number.split(decimal);
  if (extra !== undefined || (fraction !== undefined && !/^\d*$/.test(fraction))) throw new Error('CHART_NUMBER_SYNTAX');
  const integer = grouping === ' ' ? whole.replace(/[\u00A0\u202F]/g, ' ') : whole;
  const groups = grouping ? integer.split(grouping) : [integer];
  if (groups.length === 1 && !/^\d*$/.test(groups[0])) throw new Error('CHART_NUMBER_SYNTAX');
  if (groups.length > 1 && (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(part => !/^\d{3}$/.test(part)))) {
    throw new Error('CHART_NUMBER_SYNTAX');
  }
  return canonicalChartNumber(sign + groups.join('') + (fraction === undefined ? '' : '.' + fraction) + exponent);
}

function compareDecimals(a: Decimal, b: Decimal) {
  const scale = Math.max(a.scale, b.scale);
  const difference = a.coefficient * powerOfTen(scale - a.scale) - b.coefficient * powerOfTen(scale - b.scale);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function compareChartNumbers(a: string, b: string) {
  return compareDecimals(parseDecimal(a), parseDecimal(b));
}

function asRational({ coefficient, scale }: Decimal, divisor = 1): Rational {
  return { numerator: coefficient, denominator: powerOfTen(scale) * BigInt(divisor) };
}

function reduceRational(numerator: bigint, denominator: bigint): Rational {
  let a = absolute(numerator);
  let b = denominator;
  while (b) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}

function displayChartValue(value: Rational, power10 = 0): ChartValue {
  if (!Number.isInteger(power10) || power10 < -12 || power10 > 12) throw new Error('CHART_SCALE_UNSUPPORTED');
  const exact = reduceRational(value.numerator * powerOfTen(Math.max(0, power10)),
    value.denominator * powerOfTen(Math.max(0, -power10)));
  const magnitude = absolute(exact.numerator);
  if (magnitude > renderMagnitude * exact.denominator) throw new Error('CHART_RANGE_UNSUPPORTED');
  const scaled = magnitude * powerOfTen(displayPlaces);
  let rounded = scaled / exact.denominator;
  const remainder = scaled % exact.denominator;
  const twiceRemainder = 2n * remainder;
  if (twiceRemainder > exact.denominator || (twiceRemainder === exact.denominator && rounded % 2n)) rounded++;
  return { exact, display: formatDecimal(exact.numerator < 0n ? -rounded : rounded, displayPlaces), approximate: remainder !== 0n };
}

export function chartValue(token: string, power10 = 0) {
  return displayChartValue(asRational(parseDecimal(token)), power10);
}

export function aggregateChartValues(values: readonly (string | null)[], method: NumericAggregate, power10 = 0) {
  const numbers = values.flatMap(value => value === null ? [] : [parseDecimal(value)]);
  const countRows = values.length;
  const countValues = numbers.length;
  let exact: Rational | null = null;
  if (method === 'countRows' || method === 'countValues') {
    exact = { numerator: BigInt(method === 'countRows' ? countRows : countValues), denominator: 1n };
  } else if (countValues && (method === 'min' || method === 'max')) {
    const chosen = numbers.reduce((previous, current) => {
      const comparison = compareDecimals(current, previous);
      return (method === 'min' ? comparison < 0 : comparison > 0) ? current : previous;
    });
    exact = asRational(chosen);
  } else if (countValues) {
    const scale = numbers.reduce((largest, number) => Math.max(largest, number.scale), 0);
    const coefficient = numbers.reduce((sum, number) => sum + number.coefficient * powerOfTen(scale - number.scale), 0n);
    exact = asRational({ coefficient, scale }, method === 'mean' ? countValues : 1);
  }
  return { countRows, countValues, value: exact && displayChartValue(exact, power10) };
}
