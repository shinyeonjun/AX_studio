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

interface ColumnStats {
  count: number;
  sum: number;
  min: number;
  max: number;
}

/**
 * Per-column statistics, computed once per row array. Snapshot and filtered row arrays are never
 * mutated after they are built, so discovery's many hypotheses over the same rows (every function
 * of every column, every example) read one cached pass instead of rescanning the table each time.
 */
const statsByRows = new WeakMap<TableArtifact['rows'], Map<string, ColumnStats>>();

function columnStats(rows: TableArtifact['rows'], column: string): ColumnStats {
  let byColumn = statsByRows.get(rows);
  if (!byColumn) {
    byColumn = new Map();
    statsByRows.set(rows, byColumn);
  }
  const cached = byColumn.get(column);
  if (cached) return cached;
  // One pass, no intermediate arrays; Math.min(...values) would also overflow the stack on large tables.
  const stats: ColumnStats = { count: 0, sum: 0, min: Infinity, max: -Infinity };
  for (const row of rows) {
    const value = toNumber(ownCell(row.values, column));
    if (value == null) continue;
    stats.count += 1;
    stats.sum += value;
    if (value < stats.min) stats.min = value;
    if (value > stats.max) stats.max = value;
  }
  byColumn.set(column, stats);
  return stats;
}

function unroundedAggregate(rows: TableArtifact['rows'], spec: AggregateSpec): number | null {
  if (spec.fn === 'count') return rows.length;
  const column = spec.column;
  if (!column) throw new Error('aggregate_column_required');
  const stats = columnStats(rows, column);
  if (stats.count === 0) return null;
  switch (spec.fn) {
    case 'sum':
      return stats.sum;
    case 'avg':
      return stats.sum / stats.count;
    case 'min':
      return stats.min;
    case 'max':
      return stats.max;
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
