import type { TransformExpr } from '../dsl.js';
import type {
  SnapshotTables,
  TransformEvaluation,
  TransformEvaluator,
} from './contracts.js';
import { requireCompleteTable, toNumber } from './helpers.js';

export function evaluateAggregate(
  expr: Extract<TransformExpr, { op: 'aggregate' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireCompleteTable(evaluate(expr.input, snapshots), 'aggregate_input_not_table');
  const column = expr.column;
  if (expr.fn === 'count') return table.rows.length;
  if (!column) throw new Error('aggregate_column_required');
  const numbers = table.rows
    .map((row) => toNumber(row.values[column] ?? null))
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
  return (numerator / denominator) * (expr.multiplyBy ?? 1);
}
