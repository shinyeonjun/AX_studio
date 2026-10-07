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
import { compareForSort } from './table.js';

/**
 * Group key of one row: trimmed text of the cell; empty keys do not form a group. Text is NFC so
 * that a name typed on Windows and the same name from a Mac file (decomposed 한글) are one group.
 */
export function groupKeyOf(row: TableArtifact['rows'][number], column: string): string | undefined {
  const value = ownCell(row.values, column);
  if (value == null) return undefined;
  const key = String(value).normalize('NFC').trim();
  return key ? key : undefined;
}

type GroupExpr = Extract<TransformExpr, { op: 'group' }>;

/** Key columns of a group expression, outermost first, with their output headers. */
export function groupKeySpecs(expr: Pick<GroupExpr, 'by' | 'keyAs' | 'thenBy'>): Array<{ by: string; as: string }> {
  return [
    { by: expr.by, as: expr.keyAs ?? expr.by },
    ...(expr.thenBy ?? []).map((entry) => ({ by: entry.by, as: entry.keyAs ?? entry.by })),
  ];
}

export interface RowGroup {
  /** One trimmed key per key column. */
  keys: string[];
  rows: TableArtifact['rows'];
}

/**
 * Rows per distinct key combination, in first-appearance order. A row with an empty key in any
 * key column belongs to no group (as with a single key).
 */
export function groupRowsBy(rows: TableArtifact['rows'], columns: readonly string[]): Map<string, RowGroup> {
  const groups = new Map<string, RowGroup>();
  for (const row of rows) {
    const keys: string[] = [];
    for (const column of columns) {
      const key = groupKeyOf(row, column);
      if (key === undefined) break;
      keys.push(key);
    }
    if (keys.length !== columns.length) continue;
    const identity = columns.length === 1 ? keys[0]! : JSON.stringify(keys);
    const group = groups.get(identity);
    if (group) group.rows.push(row);
    else groups.set(identity, { keys, rows: [row] });
  }
  return groups;
}

export function evaluateGroup(
  expr: GroupExpr,
  snapshots: SnapshotTables,
  evaluate: TransformEvaluator,
): TransformEvaluation {
  const table = requireCompleteTable(evaluate(expr.input, snapshots), 'group_input_not_table');
  const keySpecs = groupKeySpecs(expr);
  const headers = [...keySpecs.map((spec) => spec.as), ...expr.aggregates.map((aggregate) => aggregate.as)];
  if (new Set(headers).size !== headers.length) throw new Error('group_duplicate_output_column');
  const matrix: unknown[][] = [];
  for (const { keys, rows } of groupRowsBy(table.rows, keySpecs.map((spec) => spec.by)).values()) {
    matrix.push([...keys, ...expr.aggregates.map((aggregate) => aggregateRows(rows, aggregate))]);
  }
  if (expr.orderBy) {
    const order = expr.orderBy.map((key) => {
      const index = headers.indexOf(key.column);
      if (index < 0) throw new Error('group_order_column_missing');
      return { index, direction: key.direction };
    });
    // Stable: equal rows keep first-appearance order.
    matrix.sort((left, right) => {
      for (const key of order) {
        const comparison = compareForSort(left[key.index], right[key.index], key);
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
  }
  if (expr.totalRow) {
    const emptyKeys = keySpecs.slice(1).map(() => null);
    matrix.push([expr.totalRow.label, ...emptyKeys, ...expr.aggregates.map((aggregate) => aggregateRows(table.rows, aggregate))]);
  }
  return buildTableArtifact({
    id: `group:${keySpecs.map((spec) => spec.by).join('+')}`,
    headers,
    matrix,
    rowLimit: MAX_TABLE_ROW_LIMIT,
    // Keys stay text ("001" must not become 1); aggregates are already numbers.
    scalarPolicy: 'preserve',
  });
}
