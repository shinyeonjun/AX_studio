import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { TransformExpr } from '../../workflow/transform-expr/dsl.js';
import { groupKeyOf, groupRowsBy } from '../../workflow/transform-expr/evaluator/group.js';
import { aggregateRows, type AggregateSpec } from '../../workflow/transform-expr/evaluator/numeric.js';
import { compareForSort } from '../../workflow/transform-expr/evaluator/table.js';
import type { ObservationValue } from '../observation/schema.js';
import { nonNumericKeyColumns, normalizeCellText, tableRowKey } from '../observation/table-key.js';
import type { SourceDescriptor } from '../schema.js';
import {
  aggregateSpecs,
  decimalsOf,
  isCompleteTable,
  numericSourceColumns,
  sameNumber,
} from './aggregate-specs.js';
import { candidateRowFilters, type RowFilter } from './row-filters.js';

type ExpectedTable = Extract<ObservationValue, { kind: 'table' }>;
type ReportRow = ExpectedTable['rows'][number];

export interface GroupCandidate {
  expr: TransformExpr;
  sourceId: string;
  /** Row filter identity (empty when unfiltered), for cross-field consistency. */
  filterKey: string;
}

function cell(row: ReportRow, column: string): unknown {
  return Object.hasOwn(row, column) ? row[column] : null;
}

function numericValues(expected: ExpectedTable, column: string): number[] | undefined {
  const values = expected.rows.map((row) => cell(row, column));
  return values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))
    ? values
    : undefined;
}

interface Measure {
  column: string;
  specs: AggregateSpec[];
}

/** The report's group rows split from at most one row whose key is not a source key. */
interface KeyAlignment {
  byKey: Map<string, ReportRow>;
  leftover?: ReportRow;
}

function alignKeys(
  expected: ExpectedTable,
  keyColumns: readonly string[],
  sourceKeys: ReadonlySet<string>,
): KeyAlignment | undefined {
  const byKey = new Map<string, ReportRow>();
  let leftover: ReportRow | undefined;
  for (const row of expected.rows) {
    const key = tableRowKey(row, keyColumns);
    if (sourceKeys.has(key)) {
      byKey.set(key, row);
      continue;
    }
    // At most one report row may be something other than a group (a possible total row).
    if (leftover) return undefined;
    leftover = row;
  }
  return byKey.size > 0 ? { byKey, leftover } : undefined;
}

function sourceValueSet(rows: TableArtifact['rows'], column: string): Set<string> {
  const values = new Set<string>();
  for (const row of rows) {
    const value = groupKeyOf(row, column);
    if (value !== undefined) values.add(normalizeCellText(value));
  }
  return values;
}

/**
 * Source columns that can hold one report key column: every non-empty report value is a value of
 * the source column, except at most one (a total row's label).
 */
function sourceColumnsFor(expected: ExpectedTable, keyColumn: string, table: TableArtifact): string[] {
  const reportValues = new Set(expected.rows
    .map((row) => normalizeCellText(cell(row, keyColumn)))
    .filter((value) => value !== ''));
  return table.columns.map((column) => column.name).filter((column) => {
    const values = sourceValueSet(table.rows, column);
    let missing = 0;
    for (const value of reportValues) {
      if (!values.has(value)) missing += 1;
      if (missing > 1) return false;
    }
    return missing < reportValues.size;
  });
}

/** Search bound, not semantics: source-column assignments tried per report key. */
const MAX_KEY_ASSIGNMENTS = 16;

/** Distinct source columns for each report key column, outermost first. */
function keyAssignments(options: readonly string[][]): string[][] {
  const assignments: string[][] = [];
  const extend = (prefix: string[], depth: number): void => {
    if (assignments.length >= MAX_KEY_ASSIGNMENTS) return;
    if (depth === options.length) {
      assignments.push(prefix);
      return;
    }
    for (const column of options[depth]!) {
      if (!prefix.includes(column)) extend([...prefix, column], depth + 1);
    }
  };
  extend([], 0);
  return assignments;
}

/**
 * The simplest spec reproducing this measure for every group and, when the report has a
 * leftover row, the same spec over all kept rows for that row. That arithmetic check is the
 * only thing that makes a leftover row a total row; its label text is never interpreted.
 */
function findSpec(
  measure: Measure,
  groups: Array<{ rows: TableArtifact['rows']; expected: number }>,
  total: { rows: TableArtifact['rows']; expected: number } | undefined,
): AggregateSpec | undefined {
  return measure.specs.find((spec) =>
    groups.every((group) => sameNumber(aggregateRows(group.rows, spec), group.expected)) &&
    (!total || sameNumber(aggregateRows(total.rows, spec), total.expected)));
}

type GroupOrder = NonNullable<Extract<TransformExpr, { op: 'group' }>['orderBy']>;

/** Fewer groups are always in some column's order: two rows prove nothing about a sort. */
const MIN_GROUPS_FOR_ORDER = 3;

/**
 * The order the example lists its groups in, when the data does not already come in that order:
 * the output column and direction that puts the groups exactly in the example's order ("by 매출,
 * largest first"). Only when exactly one column and direction does, over enough groups; a
 * coincidence (two columns agreeing, two rows) learns nothing.
 */
function inferGroupOrder(
  groups: ReadonlyArray<{ key: string; values: Record<string, unknown> }>,
  exampleOrder: readonly string[],
  columns: readonly string[],
): GroupOrder | undefined {
  const sameOrder = (keys: readonly string[]) => keys.length === exampleOrder.length && keys.every((key, index) => key === exampleOrder[index]);
  if (groups.length < MIN_GROUPS_FOR_ORDER || sameOrder(groups.map((group) => group.key))) return undefined;
  const explanations: GroupOrder = [];
  for (const column of columns) {
    for (const direction of ['desc', 'asc'] as const) {
      const sorted = [...groups].sort((left, right) => compareForSort(left.values[column], right.values[column], { direction }));
      if (sameOrder(sorted.map((group) => group.key))) explanations.push({ column, direction });
    }
  }
  return explanations.length === 1 ? explanations : undefined;
}

function trySynthesize(params: {
  expected: ExpectedTable;
  keyColumns: readonly string[];
  measures: Measure[];
  sourceId: string;
  groupColumns: readonly string[];
  filter: RowFilter | undefined;
  rows: TableArtifact['rows'];
}): GroupCandidate | undefined {
  const { expected, keyColumns, measures, groupColumns, rows } = params;
  const groupsByKey = new Map<string, TableArtifact['rows']>();
  for (const group of groupRowsBy(rows, groupColumns).values()) {
    const normalized = group.keys.map(normalizeCellText);
    groupsByKey.set(normalized.length === 1 ? normalized[0]! : JSON.stringify(normalized), group.rows);
  }
  const alignment = alignKeys(expected, keyColumns, new Set(groupsByKey.keys()));
  // Every group the rule would output must be a report row, and every other report row but one must be a group.
  if (!alignment || alignment.byKey.size !== groupsByKey.size) return undefined;
  const leftover = alignment.leftover;
  // A total row carries its label in the first key column; nested key columns stay empty.
  if (leftover) {
    if (normalizeCellText(cell(leftover, keyColumns[0]!)) === '') return undefined;
    if (keyColumns.slice(1).some((column) => normalizeCellText(cell(leftover, column)) !== '')) return undefined;
  }
  const aggregates: Extract<TransformExpr, { op: 'group' }>['aggregates'] = [];
  for (const measure of measures) {
    const groups = [...alignment.byKey].map(([key, row]) => ({
      rows: groupsByKey.get(key)!,
      expected: cell(row, measure.column) as number,
    }));
    const total = leftover ? { rows, expected: cell(leftover, measure.column) as number } : undefined;
    const spec = findSpec(measure, groups, total);
    if (!spec) return undefined;
    aggregates.push({ as: measure.column, ...spec });
  }
  const groupRows = [...groupRowsBy(rows, groupColumns).values()].map((group) => {
    const normalized = group.keys.map(normalizeCellText);
    const values: Record<string, unknown> = Object.fromEntries(keyColumns.map((column, index) => [column, group.keys[index]]));
    for (const aggregate of aggregates) values[aggregate.as] = aggregateRows(group.rows, aggregate);
    return { key: normalized.length === 1 ? normalized[0]! : JSON.stringify(normalized), values };
  });
  const exampleOrder = expected.rows.filter((row) => row !== leftover).map((row) => tableRowKey(row, keyColumns));
  const orderBy = inferGroupOrder(groupRows, exampleOrder, [...measures.map((measure) => measure.column), ...keyColumns]);
  const source: TransformExpr = { op: 'source', sourceId: params.sourceId };
  const input: TransformExpr = params.filter ? { op: 'filter', input: source, where: params.filter.where } : source;
  return {
    sourceId: params.sourceId,
    filterKey: params.filter?.key ?? '',
    expr: {
      op: 'group',
      input,
      by: groupColumns[0]!,
      keyAs: keyColumns[0]!,
      ...(groupColumns.length > 1
        ? { thenBy: groupColumns.slice(1).map((by, index) => ({ by, keyAs: keyColumns[index + 1]! })) }
        : {}),
      aggregates,
      ...(leftover ? { totalRow: { label: String(cell(leftover, keyColumns[0]!)) } } : {}),
      ...(orderBy ? { orderBy } : {}),
    },
  };
}

/**
 * Constructs group-by rules that reproduce a report table from one source table, verified
 * against the example's own snapshot before they become candidates. Everything is decided
 * from data: which report columns hold keys (one, or a combination such as region + category),
 * which source column's values each key column holds, which rows a filter keeps, and which
 * aggregate explains each measure.
 */
export function synthesizeGroupCandidates(
  expected: ExpectedTable,
  sources: SourceDescriptor[],
  snapshots: Record<string, TableArtifact>,
): GroupCandidate[] {
  const candidates: GroupCandidate[] = [];
  // A grouped table is its key columns plus aggregates, so every non-numeric column is a key, and a
  // column the example happens to make unique on its own still nests (region, then category).
  const keyColumns = nonNumericKeyColumns(expected);
  if (!keyColumns) return candidates;
  const measureColumns = expected.columns.filter((column) => !keyColumns.includes(column));
  if (measureColumns.length === 0) return candidates;
  const measureValues = measureColumns.map((column) => numericValues(expected, column));
  if (measureValues.some((values) => !values)) return candidates;
  for (const source of sources) {
    const table = Object.hasOwn(snapshots, source.id) ? snapshots[source.id] : undefined;
    if (!table || !isCompleteTable(table)) continue;
    const numericColumns = numericSourceColumns(table);
    const measures: Measure[] = measureColumns.map((column, index) => {
      const decimals = Math.max(0, ...measureValues[index]!.map(decimalsOf));
      return { column, specs: aggregateSpecs(numericColumns, decimals) };
    });
    const options = keyColumns.map((keyColumn) => sourceColumnsFor(expected, keyColumn, table));
    for (const groupColumns of keyAssignments(options)) {
      // Filters only remove groups, so the unfiltered key set must already cover the report.
      const filters: Array<RowFilter | undefined> = [undefined, ...candidateRowFilters(table, new Set(groupColumns))];
      for (const filter of filters) {
        const candidate = trySynthesize({
          expected,
          keyColumns,
          measures,
          sourceId: source.id,
          groupColumns,
          filter,
          rows: filter ? filter.rows : table.rows,
        });
        // Every filter that explains every cell; the caller picks among them by cross-field consistency.
        if (candidate) candidates.push(candidate);
      }
    }
  }
  return candidates;
}
