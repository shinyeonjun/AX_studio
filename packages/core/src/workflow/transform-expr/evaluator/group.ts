import { buildTableArtifact, MAX_TABLE_ROW_LIMIT } from '../../../contracts/artifacts/table-build.js';
import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import type { TransformExpr } from '../dsl.js';
import type {
  SnapshotTables,
  TransformEvaluation,
  TransformEvaluator,
} from './contracts.js';
import { ownCell, requireCompleteTable } from './helpers.js';
import { aggregateRows } from './numeric.js';

/** Group key of one row: trimmed text of the cell; empty keys do not form a group. */
export function groupKeyOf(row: TableArtifact['rows'][number], column: string): string | undefined {
  const value = ownCell(row.values, column);
  if (value == null) return undefined;
  const key = String(value).trim();
  return key ? key : undefined;
}

/** Rows per distinct key, in first-appearance order. */
export function groupRowsBy(
  rows: TableArtifact['rows'],
  column: string,
): Map<string, TableArtifact['rows']> {
  const groups = new Map<string, TableArtifact['rows']>();
  for (const row of rows) {
    const key = groupKeyOf(row, column);
    if (key === undefined) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

export function evaluateGroup(
  expr: Extract<TransformExpr, { op: 'group' }>,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireCompleteTable(evaluate(expr.input, snapshots), 'group_input_not_table');
  const headers = [expr.keyAs ?? expr.by, ...expr.aggregates.map((aggregate) => aggregate.as)];
  if (new Set(headers).size !== headers.length) throw new Error('group_duplicate_output_column');
  const matrix: unknown[][] = [];
  for (const [key, rows] of groupRowsBy(table.rows, expr.by)) {
    matrix.push([key, ...expr.aggregates.map((aggregate) => aggregateRows(rows, aggregate))]);
  }
  if (expr.totalRow) {
    matrix.push([expr.totalRow.label, ...expr.aggregates.map((aggregate) => aggregateRows(table.rows, aggregate))]);
  }
  return buildTableArtifact({
    id: `group:${expr.by}`,
    headers,
    matrix,
    rowLimit: MAX_TABLE_ROW_LIMIT,
    // Keys stay text ("001" must not become 1); aggregates are already numbers.
    scalarPolicy: 'preserve',
  });
}
