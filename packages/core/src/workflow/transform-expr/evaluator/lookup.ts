import type { TransformExpr } from '../dsl.js';
import type {
  SnapshotTables,
  TransformEvaluation,
  TransformEvaluator,
} from './contracts.js';
import { compareScalar, requireTable } from './helpers.js';

export function evaluateLookup(
  expr: Extract<TransformExpr, { op: 'lookup' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireTable(evaluate(expr.input, snapshots), 'lookup_input_not_table');
  const row = table.rows.find((entry) => compareScalar(entry.values[expr.keyColumn] ?? null, expr.keyValue));
  return row?.values[expr.valueColumn] ?? null;
}
