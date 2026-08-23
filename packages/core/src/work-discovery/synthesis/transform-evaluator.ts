import type { ScalarValue, TableArtifact } from '../../contracts/artifacts/table.js';
import type { ConditionExpr } from '../../runtime/condition-expr.js';
import type { TransformExpr } from './transform-dsl.js';

export type SnapshotTables = Record<string, TableArtifact>;

function rowValue(row: TableArtifact['rows'][number], column: string): ScalarValue {
  return row.values[column] ?? null;
}

function compareScalar(left: ScalarValue, right: ScalarValue): boolean {
  if (left == null || right == null) return left === right;
  if (typeof left === 'number' && typeof right === 'number') return left === right;
  return String(left) === String(right);
}

function evaluateConditionOnRow(expr: ConditionExpr, row: TableArtifact['rows'][number]): boolean {
  switch (expr.op) {
    case 'eq':
      return compareScalar(
        'lit' in expr.left ? expr.left.lit : rowValue(row, expr.left.ref),
        'lit' in expr.right ? expr.right.lit : rowValue(row, expr.right.ref),
      );
    case 'neq':
      return !compareScalar(
        'lit' in expr.left ? expr.left.lit : rowValue(row, expr.left.ref),
        'lit' in expr.right ? expr.right.lit : rowValue(row, expr.right.ref),
      );
    case 'contains': {
      const left = 'lit' in expr.left ? expr.left.lit : rowValue(row, expr.left.ref);
      const right = 'lit' in expr.right ? expr.right.lit : rowValue(row, expr.right.ref);
      return String(left ?? '').includes(String(right ?? ''));
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const left = Number('lit' in expr.left ? expr.left.lit : rowValue(row, expr.left.ref));
      const right = Number('lit' in expr.right ? expr.right.lit : rowValue(row, expr.right.ref));
      if (Number.isNaN(left) || Number.isNaN(right)) return false;
      if (expr.op === 'gt') return left > right;
      if (expr.op === 'gte') return left >= right;
      if (expr.op === 'lt') return left < right;
      return left <= right;
    }
    case 'and':
      return expr.args.every((arg) => evaluateConditionOnRow(arg, row));
    case 'or':
      return expr.args.some((arg) => evaluateConditionOnRow(arg, row));
    case 'not':
      return !evaluateConditionOnRow(expr.arg, row);
    default:
      return false;
  }
}

function toNumber(value: ScalarValue): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function evaluateTransformExpr(expr: TransformExpr, snapshots: SnapshotTables): ScalarValue | TableArtifact {
  switch (expr.op) {
    case 'source': {
      const table = snapshots[expr.sourceId];
      if (!table) throw new Error(`snapshot_not_found:${expr.sourceId}`);
      return table;
    }
    case 'column': {
      const input = evaluateTransformExpr(expr.input, snapshots);
      if (!input || typeof input !== 'object' || !('rows' in input)) {
        throw new Error('column_input_not_table');
      }
      const table = input as TableArtifact;
      const column = expr.name;
      const values = table.rows.map((row) => row.values[column] ?? null);
      return values.length === 1 ? (values[0] ?? null) : JSON.stringify(values);
    }
    case 'filter': {
      const input = evaluateTransformExpr(expr.input, snapshots);
      if (!input || typeof input !== 'object' || !('rows' in input)) {
        throw new Error('filter_input_not_table');
      }
      const table = input as TableArtifact;
      return {
        ...table,
        rows: table.rows.filter((row) => evaluateConditionOnRow(expr.where, row)),
      };
    }
    case 'aggregate': {
      const input = evaluateTransformExpr(expr.input, snapshots);
      if (!input || typeof input !== 'object' || !('rows' in input)) {
        throw new Error('aggregate_input_not_table');
      }
      const table = input as TableArtifact;
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
    case 'ratio': {
      const numerator = Number(evaluateTransformExpr(expr.numerator, snapshots));
      const denominator = Number(evaluateTransformExpr(expr.denominator, snapshots));
      if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
      return (numerator / denominator) * (expr.multiplyBy ?? 1);
    }
    case 'lookup': {
      const input = evaluateTransformExpr(expr.input, snapshots);
      if (!input || typeof input !== 'object' || !('rows' in input)) {
        throw new Error('lookup_input_not_table');
      }
      const table = input as TableArtifact;
      const row = table.rows.find((entry) => compareScalar(entry.values[expr.keyColumn] ?? null, expr.keyValue));
      return row?.values[expr.valueColumn] ?? null;
    }
    case 'select': {
      const input = evaluateTransformExpr(expr.input, snapshots);
      if (!input || typeof input !== 'object' || !('rows' in input)) {
        throw new Error('select_input_not_table');
      }
      const table = input as TableArtifact;
      return {
        ...table,
        columns: table.columns.filter((column) => expr.columns.includes(column.name)),
        rows: table.rows.map((row, index) => ({
          index,
          values: Object.fromEntries(expr.columns.map((name) => [name, row.values[name] ?? null])),
        })),
      };
    }
    case 'sort': {
      const input = evaluateTransformExpr(expr.input, snapshots);
      if (!input || typeof input !== 'object' || !('rows' in input)) {
        throw new Error('sort_input_not_table');
      }
      const table = input as TableArtifact;
      const sorted = [...table.rows].sort((left, right) => {
        for (const key of expr.by) {
          const leftValue = left.values[key.column];
          const rightValue = right.values[key.column];
          if (leftValue === rightValue) continue;
          const direction = key.direction === 'desc' ? -1 : 1;
          return String(leftValue) < String(rightValue) ? -direction : direction;
        }
        return 0;
      });
      return { ...table, rows: sorted.map((row, index) => ({ ...row, index })) };
    }
    case 'limit': {
      const input = evaluateTransformExpr(expr.input, snapshots);
      if (!input || typeof input !== 'object' || !('rows' in input)) {
        throw new Error('limit_input_not_table');
      }
      const table = input as TableArtifact;
      return { ...table, rows: table.rows.slice(0, expr.count) };
    }
    default:
      throw new Error('unsupported_transform_op');
  }
}

export function compareObservationValue(expected: unknown, actual: ScalarValue): number {
  if (expected == null || actual == null) return expected === actual ? 1 : 0;
  const expectedNumber = typeof expected === 'number' ? expected : Number(String(expected).replace(/,/g, ''));
  const actualNumber = typeof actual === 'number' ? actual : Number(String(actual).replace(/,/g, ''));
  if (Number.isFinite(expectedNumber) && Number.isFinite(actualNumber)) {
    if (expectedNumber === actualNumber) return 1;
    const delta = Math.abs(expectedNumber - actualNumber);
    const scale = Math.max(Math.abs(expectedNumber), Math.abs(actualNumber), 1);
    if (delta / scale <= 0.01) return 0.95;
    return 0;
  }
  return String(expected) === String(actual) ? 1 : 0;
}
