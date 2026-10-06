import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { ConditionExpr } from '../../workflow/condition-expr/schema.js';
import { evaluateConditionOnRow } from '../../workflow/transform-expr/evaluator/conditions.js';

/**
 * Search bound, not semantics: a column is tried as a row-filter dimension only when its values
 * repeat (at most this many distinct values and at most one per two rows). Columns of ids,
 * dates or amounts are effectively never single-value filters, and the search stays small.
 */
const MAX_CATEGORICAL_VALUES = 12;

/** Search bound, not semantics: at most this many `col = v` / `col ≠ v` filters are tried per source. */
const MAX_FILTER_CANDIDATES = 32;

export interface RowFilter {
  where: ConditionExpr;
  /** Identity used to tell rules that keep different rows apart. */
  key: string;
  rows: TableArtifact['rows'];
}

function distinctValues(table: TableArtifact, column: string): Map<string, string | number | boolean> {
  const values = new Map<string, string | number | boolean>();
  for (const row of table.rows) {
    const value = Object.hasOwn(row.values, column) ? row.values[column] : null;
    if (value == null || String(value).trim() === '') continue;
    const identity = String(value);
    if (!values.has(identity)) values.set(identity, value);
  }
  return values;
}

/**
 * Single-value row filters worth trying on this table, decided only from its data: columns whose
 * values repeat (categorical), fewest distinct values first. Filters that keep every row, no row,
 * or exactly the same rows as an earlier filter are dropped (the evidence cannot tell them apart).
 */
export function candidateRowFilters(table: TableArtifact, excludeColumns: ReadonlySet<string>): readonly RowFilter[] {
  // Every numeric field and every report table asks for the same filters; build them once per table,
  // and hand out the same row arrays so the per-rows aggregate cache is shared too.
  const key = JSON.stringify([...excludeColumns].sort());
  let byExclusion = filtersByTable.get(table);
  if (!byExclusion) {
    byExclusion = new Map();
    filtersByTable.set(table, byExclusion);
  }
  const cached = byExclusion.get(key);
  if (cached) return cached;
  const filters = buildRowFilters(table, excludeColumns);
  byExclusion.set(key, filters);
  return filters;
}

const filtersByTable = new WeakMap<TableArtifact, Map<string, readonly RowFilter[]>>();

function buildRowFilters(table: TableArtifact, excludeColumns: ReadonlySet<string>): RowFilter[] {
  const rowCount = table.rows.length;
  const dimensions = table.columns
    .filter((column) => !excludeColumns.has(column.name))
    .map((column, index) => ({ name: column.name, index, values: distinctValues(table, column.name) }))
    .filter(({ values }) => values.size >= 2 && values.size <= MAX_CATEGORICAL_VALUES && values.size <= rowCount / 2)
    .sort((left, right) => left.values.size - right.values.size || left.index - right.index);
  const filters: RowFilter[] = [];
  const seenMasks = new Set<string>();
  for (const dimension of dimensions) {
    for (const literal of dimension.values.values()) {
      for (const op of ['neq', 'eq'] as const) {
        if (filters.length >= MAX_FILTER_CANDIDATES) return filters;
        const where: ConditionExpr = { op, left: { ref: dimension.name }, right: { lit: literal } };
        const mask = table.rows.map((row) => evaluateConditionOnRow(where, row));
        const kept = mask.filter(Boolean).length;
        if (kept === 0 || kept === rowCount) continue;
        const maskKey = mask.map((keep) => (keep ? '1' : '0')).join('');
        if (seenMasks.has(maskKey)) continue;
        seenMasks.add(maskKey);
        filters.push({ where, key: JSON.stringify(where), rows: table.rows.filter((_, index) => mask[index]) });
      }
    }
  }
  return filters;
}
