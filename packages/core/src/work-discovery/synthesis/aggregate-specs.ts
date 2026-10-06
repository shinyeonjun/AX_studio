import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { AggregateSpec } from '../../workflow/transform-expr/evaluator/numeric.js';

export function numericSourceColumns(table: TableArtifact): string[] {
  return table.columns
    .filter((column) =>
      column.type === 'number' ||
      column.type === 'integer' ||
      column.type === 'currency' ||
      column.type === 'percentage')
    .map((column) => column.name);
}

export function isCompleteTable(table: TableArtifact): boolean {
  const status = table.completeness?.status ?? (table.truncated ? 'partial' : 'complete');
  return !table.truncated && status === 'complete' && table.coverage?.source !== 'partial';
}

/** Exact up to binary float noise: constructive search must not accept "close enough" numbers. */
export function sameNumber(actual: number | null, expected: number): boolean {
  if (actual == null || !Number.isFinite(actual)) return false;
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(actual), Math.abs(expected));
}

/** Decimal places a stored report number carries (58218 -> 0, 12.35 -> 2), capped at the DSL limit. */
export function decimalsOf(value: number): number {
  const text = String(value);
  if (/e/i.test(text)) return 0;
  const fraction = text.split('.')[1];
  return fraction ? Math.min(fraction.length, 6) : 0;
}

/** The DSL's maximum rounding precision; a report showing this many decimals is treated as unrounded. */
const MAX_ROUND_DECIMALS = 6;

/**
 * Aggregate specs in simplicity order: COUNT, then each function over every numeric column.
 * When the report shows a bounded precision, the average rounded to it comes before the exact
 * average: both reproduce an example whose averages happen to terminate early, but only the
 * rounded one keeps matching a month whose averages do not.
 */
export function aggregateSpecs(numericColumns: string[], decimals: number | undefined): AggregateSpec[] {
  const specs: AggregateSpec[] = [{ fn: 'count' }];
  for (const column of numericColumns) specs.push({ fn: 'sum', column });
  const rounded = decimals !== undefined && decimals < MAX_ROUND_DECIMALS;
  for (const column of numericColumns) {
    if (rounded) specs.push({ fn: 'avg', column, round: decimals });
    specs.push({ fn: 'avg', column });
  }
  for (const column of numericColumns) specs.push({ fn: 'min', column });
  for (const column of numericColumns) specs.push({ fn: 'max', column });
  return specs;
}

export function specSimplicity(spec: AggregateSpec): number {
  if (spec.fn === 'count') return 0.65;
  if (spec.fn === 'sum') return 0.7;
  if (spec.fn === 'avg') return spec.round === undefined ? 0.6 : 0.58;
  return 0.55;
}
