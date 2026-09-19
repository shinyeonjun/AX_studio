import type { TransformExpr } from '../dsl.js';
import type {
  SnapshotTables,
  TransformEvaluation,
  TransformEvaluator,
} from './contracts.js';
import { evaluateConditionOnRow } from './conditions.js';
import { requireTable } from './helpers.js';

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left) < String(right) ? -1 : 1;
}

export function evaluateColumn(
  expr: Extract<TransformExpr, { op: 'column' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireTable(evaluate(expr.input, snapshots), 'column_input_not_table');
  const values = table.rows.map((row) => row.values[expr.name] ?? null);
  return values.length === 1 ? (values[0] ?? null) : JSON.stringify(values);
}

export function evaluateFilter(
  expr: Extract<TransformExpr, { op: 'filter' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireTable(evaluate(expr.input, snapshots), 'filter_input_not_table');
  return {
    ...table,
    rows: table.rows.filter((row) => evaluateConditionOnRow(expr.where, row)),
  };
}

export function evaluateSelect(
  expr: Extract<TransformExpr, { op: 'select' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireTable(evaluate(expr.input, snapshots), 'select_input_not_table');
  return {
    ...table,
    columns: table.columns.filter((column) => expr.columns.includes(column.name)),
    rows: table.rows.map((row, index) => ({
      index,
      values: Object.fromEntries(expr.columns.map((name) => [name, row.values[name] ?? null])),
    })),
  };
}

export function evaluateSort(
  expr: Extract<TransformExpr, { op: 'sort' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireTable(evaluate(expr.input, snapshots), 'sort_input_not_table');
  const sorted = [...table.rows].sort((left, right) => {
    for (const key of expr.by) {
      const comparison = compareValues(left.values[key.column], right.values[key.column]);
      if (comparison === 0) continue;
      const direction = key.direction === 'desc' ? -1 : 1;
      return comparison * direction;
    }
    return 0;
  });
  return { ...table, rows: sorted.map((row, index) => ({ ...row, index })) };
}

export function evaluateLimit(
  expr: Extract<TransformExpr, { op: 'limit' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireTable(evaluate(expr.input, snapshots), 'limit_input_not_table');
  return { ...table, rows: table.rows.slice(0, expr.count) };
}
