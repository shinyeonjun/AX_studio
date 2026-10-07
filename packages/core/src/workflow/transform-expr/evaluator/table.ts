import type { TransformExpr } from '../dsl.js';
import type {
  SnapshotTables,
  TransformEvaluation,
  TransformEvaluator,
} from './contracts.js';
import { evaluateConditionOnRow } from './conditions.js';
import { ownCell, requireTable, toNumber } from './helpers.js';

/** A sortable reading of a cell: numbers (including numeric text such as DB decimals) or text. */
function sortKey(value: unknown): { kind: 0; number: number } | { kind: 1; text: string } {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? toNumber(value) : null;
  return number != null && Number.isFinite(number) ? { kind: 0, number } : { kind: 1, text: String(value) };
}

/** Ascending order for present values: numbers by value, then text; a total order across types. */
function compareValues(left: unknown, right: unknown): number {
  const a = sortKey(left);
  const b = sortKey(right);
  if (a.kind !== b.kind) return a.kind - b.kind;
  if (a.kind === 0 && b.kind === 0) return a.number - b.number;
  const leftText = (a as { text: string }).text;
  const rightText = (b as { text: string }).text;
  return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

const isBlank = (value: unknown) => value == null || (typeof value === 'string' && value.trim() === '');

export function evaluateColumn(
  expr: Extract<TransformExpr, { op: 'column' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireTable(evaluate(expr.input, snapshots), 'column_input_not_table');
  const values = table.rows.map((row) => ownCell(row.values, expr.name));
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
      ...row,
      index,
      values: Object.fromEntries(expr.columns.map((name) => [name, ownCell(row.values, name)])),
      ...(row.rawValues ? {
        rawValues: Object.fromEntries(expr.columns.map((name) => [name, ownCell(row.rawValues, name)])),
      } : {}),
    })),
  };
}

export interface SortKey {
  direction: 'asc' | 'desc';
}

/**
 * Order of two cells for a sort key. Blank cells go last in either direction: "top 5 by revenue"
 * never starts with missing revenue.
 */
export function compareForSort(leftValue: unknown, rightValue: unknown, key: SortKey): number {
  const leftBlank = isBlank(leftValue);
  const rightBlank = isBlank(rightValue);
  if (leftBlank || rightBlank) return leftBlank === rightBlank ? 0 : leftBlank ? 1 : -1;
  const comparison = compareValues(leftValue, rightValue);
  return key.direction === 'desc' ? -comparison : comparison;
}

export function evaluateSort(
  expr: Extract<TransformExpr, { op: 'sort' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireTable(evaluate(expr.input, snapshots), 'sort_input_not_table');
  const sorted = [...table.rows].sort((left, right) => {
    for (const key of expr.by) {
      const comparison = compareForSort(ownCell(left.values, key.column), ownCell(right.values, key.column), key);
      if (comparison !== 0) return comparison;
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
