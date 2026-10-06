import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { TransformExpr } from '../../workflow/transform-expr/dsl.js';
import { groupKeyOf, groupRowsBy } from '../../workflow/transform-expr/evaluator/group.js';
import { aggregateRows, type AggregateSpec } from '../../workflow/transform-expr/evaluator/numeric.js';
import type { ObservationValue } from '../observation/schema.js';
import { normalizeCellText } from '../observation/table-key.js';
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

/** Report columns whose every value is distinct non-empty text: possible group keys. */
function keyColumns(expected: ExpectedTable): string[] {
  return expected.columns.filter((column) => {
    const values = expected.rows.map((row) => cell(row, column));
    if (!values.every((value) => typeof value === 'string' && normalizeCellText(value) !== '')) return false;
    return new Set(values.map(normalizeCellText)).size === values.length;
  });
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

/** The report's group rows split from at most one row whose label is not a source value. */
interface KeyAlignment {
  byKey: Map<string, ReportRow>;
  leftover?: ReportRow;
}

function alignKeys(
  expected: ExpectedTable,
  keyColumn: string,
  sourceKeys: ReadonlySet<string>,
): KeyAlignment | undefined {
  const byKey = new Map<string, ReportRow>();
  let leftover: ReportRow | undefined;
  for (const row of expected.rows) {
    const key = normalizeCellText(cell(row, keyColumn));
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

function sourceKeySet(rows: TableArtifact['rows'], column: string): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const key = groupKeyOf(row, column);
    if (key !== undefined) keys.add(normalizeCellText(key));
  }
  return keys;
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

function trySynthesize(params: {
  expected: ExpectedTable;
  keyColumn: string;
  measures: Measure[];
  sourceId: string;
  groupColumn: string;
  filter: RowFilter | undefined;
  rows: TableArtifact['rows'];
}): GroupCandidate | undefined {
  const { expected, keyColumn, measures, groupColumn, rows } = params;
  const grouped = groupRowsBy(rows, groupColumn);
  const groupsByKey = new Map<string, TableArtifact['rows']>();
  for (const [key, groupRows] of grouped) groupsByKey.set(normalizeCellText(key), groupRows);
  const alignment = alignKeys(expected, keyColumn, new Set(groupsByKey.keys()));
  // Every group the rule would output must be a report row, and every other report row but one must be a group.
  if (!alignment || alignment.byKey.size !== groupsByKey.size) return undefined;
  const aggregates: Extract<TransformExpr, { op: 'group' }>['aggregates'] = [];
  for (const measure of measures) {
    const groups = [...alignment.byKey].map(([key, row]) => ({
      rows: groupsByKey.get(key)!,
      expected: cell(row, measure.column) as number,
    }));
    const total = alignment.leftover
      ? { rows, expected: cell(alignment.leftover, measure.column) as number }
      : undefined;
    const spec = findSpec(measure, groups, total);
    if (!spec) return undefined;
    aggregates.push({ as: measure.column, ...spec });
  }
  const source: TransformExpr = { op: 'source', sourceId: params.sourceId };
  const input: TransformExpr = params.filter ? { op: 'filter', input: source, where: params.filter.where } : source;
  const totalLabel = alignment.leftover ? String(cell(alignment.leftover, keyColumn)) : undefined;
  return {
    sourceId: params.sourceId,
    filterKey: params.filter?.key ?? '',
    expr: {
      op: 'group',
      input,
      by: groupColumn,
      keyAs: keyColumn,
      aggregates,
      ...(totalLabel !== undefined ? { totalRow: { label: totalLabel } } : {}),
    },
  };
}

/**
 * Constructs group-by rules that reproduce a report table from one source table, verified
 * against the example's own snapshot before they become candidates. Everything is decided
 * from data: which report column holds keys, which source column's values those keys are,
 * which rows a filter keeps, and which aggregate explains each measure.
 */
export function synthesizeGroupCandidates(
  expected: ExpectedTable,
  sources: SourceDescriptor[],
  snapshots: Record<string, TableArtifact>,
): GroupCandidate[] {
  const candidates: GroupCandidate[] = [];
  for (const keyColumn of keyColumns(expected)) {
    const measureColumns = expected.columns.filter((column) => column !== keyColumn);
    if (measureColumns.length === 0) continue;
    const measureValues = measureColumns.map((column) => numericValues(expected, column));
    // A non-numeric non-key column cannot be produced by a group rule.
    if (measureValues.some((values) => !values)) continue;
    for (const source of sources) {
      const table = Object.hasOwn(snapshots, source.id) ? snapshots[source.id] : undefined;
      if (!table || !isCompleteTable(table)) continue;
      const numericColumns = numericSourceColumns(table);
      const measures: Measure[] = measureColumns.map((column, index) => {
        const decimals = Math.max(0, ...measureValues[index]!.map(decimalsOf));
        return { column, specs: aggregateSpecs(numericColumns, decimals) };
      });
      for (const column of table.columns) {
        // Filters only remove groups, so the unfiltered key set must already cover the report.
        if (!alignKeys(expected, keyColumn, sourceKeySet(table.rows, column.name))) continue;
        const filters: Array<RowFilter | undefined> = [undefined, ...candidateRowFilters(table, new Set([column.name]))];
        for (const filter of filters) {
          const candidate = trySynthesize({
            expected,
            keyColumn,
            measures,
            sourceId: source.id,
            groupColumn: column.name,
            filter,
            rows: filter ? filter.rows : table.rows,
          });
          // Every filter that explains every cell; the caller picks among them by cross-field consistency.
          if (candidate) candidates.push(candidate);
        }
      }
    }
  }
  return candidates;
}
