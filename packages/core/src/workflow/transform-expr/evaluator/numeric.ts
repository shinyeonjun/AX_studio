import type { TransformExpr } from '../dsl.js';
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

export function evaluateAggregate(
  expr: Extract<TransformExpr, { op: 'aggregate' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  return roundTo(aggregateValue(expr, snapshots, evaluate), expr.round);
}

function aggregateValue(
  expr: Extract<TransformExpr, { op: 'aggregate' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): number | null {
  const table = requireCompleteTable(evaluate(expr.input, snapshots), 'aggregate_input_not_table');
  const column = expr.column;
  if (expr.fn === 'count') return table.rows.length;
  if (!column) throw new Error('aggregate_column_required');
  const numbers = table.rows
    .map((row) => toNumber(ownCell(row.values, column)))
    .filter((value): value is number => value != null);
  if (numbers.length === 0) return null;
  switch (expr.fn) {
    case 'sum':
      return numbers.reduce((sum, value) => sum + value, 0);
    case 'avg':
      return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
    case 'min':
      return Math.min(...numbers);
    case 'max':
      return Math.max(...numbers);
    default:
      return null;
  }
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
