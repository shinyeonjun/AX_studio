import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import type { AggregateFn, TransformExpr } from '../dsl.js';
import type {
  SnapshotTables,
  TransformEvaluation,
  TransformEvaluator,
} from './contracts.js';
import { ownCell, requireCompleteTable, toNumber } from './helpers.js';

/** Half-up decimal rounding without binary float artifacts (1.005 -> 1.01). */
function roundTo(value: number | null, digits: number | undefined): number | null {
  if (value == null || digits === undefined) return value;
  const rounded = Number(`${Math.round(Number(`${value}e${digits}`))}e-${digits}`);
  return Number.isFinite(rounded) ? rounded : value;
}

export interface AggregateSpec {
  fn: AggregateFn;
  column?: string;
  round?: number;
}

/** One aggregate over already-selected rows; shared by `aggregate` and `group`. */
export function aggregateRows(rows: TableArtifact['rows'], spec: AggregateSpec): number | null {
  return roundTo(unroundedAggregate(rows, spec), spec.round);
}

function unroundedAggregate(rows: TableArtifact['rows'], spec: AggregateSpec): number | null {
  if (spec.fn === 'count') return rows.length;
  const column = spec.column;
  if (!column) throw new Error('aggregate_column_required');
  // One pass, no intermediate arrays; Math.min(...values) would also overflow the stack on large tables.
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const value = toNumber(ownCell(row.values, column));
    if (value == null) continue;
    count += 1;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (count === 0) return null;
  switch (spec.fn) {
    case 'sum':
      return sum;
    case 'avg':
      return sum / count;
    case 'min':
      return min;
    case 'max':
      return max;
    default:
      return null;
  }
}

export function evaluateAggregate(
  expr: Extract<TransformExpr, { op: 'aggregate' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireCompleteTable(evaluate(expr.input, snapshots), 'aggregate_input_not_table');
  return aggregateRows(table.rows, expr);
}

export function evaluateRatio(
  expr: Extract<TransformExpr, { op: 'ratio' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const numerator = Number(evaluate(expr.numerator, snapshots));
  const denominator = Number(evaluate(expr.denominator, snapshots));
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return roundTo((numerator / denominator) * (expr.multiplyBy ?? 1), expr.round);
}
