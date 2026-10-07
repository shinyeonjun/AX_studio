import type {
  ReportAggregateColumnValue,
  ReportAggregateExpression,
  ReportPlan,
} from '../../plan/schema.js';
import { isRecordValue } from '../../plan/value.js';
import {
  formatFromExampleText,
  type ReplayRepairInput,
  type ReplayRepairResult,
  numericEvidenceValue,
  mismatchedReplayTargets,
  withAggregateFilter,
  tableSourceAliases,
  aggregateColumnReferences,
} from './shared.js';
import { aggregateFilterCandidates } from './predicates.js';

function aggregateFieldPaths(
  input: ReplayRepairInput,
  table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>,
  numericOnly: boolean,
): string[] {
  const fields = new Map<string, number>();
  for (const alias of tableSourceAliases(input.plan, table)) {
    const source = input.sources[alias];
    if (!source) continue;
    for (const row of source.rows) {
      for (const [field, value] of Object.entries(row)) {
        if (numericOnly && numericEvidenceValue(value) === undefined) continue;
        const path = `${alias}.${field}`;
        fields.set(path, (fields.get(path) ?? 0) + 1);
      }
    }
  }
  return [...fields.keys()].sort((left, right) => (
    Number(/(?:^|[_.])(?:id|key|code|no|number|uuid)$/iu.test(right))
      - Number(/(?:^|[_.])(?:id|key|code|no|number|uuid)$/iu.test(left))
      || (fields.get(right) ?? 0) - (fields.get(left) ?? 0)
      || left.localeCompare(right)
  )).slice(0, 24);
}

function aggregateFieldPathsIn(value: unknown): string[] {
  const paths: string[] = [];
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!isRecordValue(candidate)) return;
    if (candidate.kind === 'field' && typeof candidate.path === 'string') paths.push(candidate.path);
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return paths;
}

function aggregateWithExistingWhere(
  expression: ReportAggregateExpression,
  table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>,
): ReportAggregateExpression {
  return withAggregateFilter(expression, table.filter);
}

function aggregateMetricCandidates(
  input: ReplayRepairInput,
  table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>,
  column: Extract<ReportAggregateColumnValue, { kind: 'aggregate' }>,
  expected: string,
): ReportAggregateExpression[] {
  const current = column.expression;
  const currentPaths = aggregateFieldPathsIn(current);
  const style = formatFromExampleText(expected)?.style;
  const identifierPaths = aggregateFieldPaths(input, table, false);
  const numericPaths = aggregateFieldPaths(input, table, true);
  const ordered = (paths: string[]) => [...new Set([...currentPaths, ...paths])];
  const candidates: ReportAggregateExpression[] = [];
  const add = (expression: ReportAggregateExpression): void => {
    const next = aggregateWithExistingWhere(expression, table);
    if (!candidates.some((candidate) => JSON.stringify(candidate) === JSON.stringify(next))) candidates.push(next);
  };
  if (style === 'integer' || ['count', 'count_distinct'].includes(current.kind)) {
    for (const path of ordered(identifierPaths)) {
      add({ kind: 'count_distinct', value: { kind: 'field', path } });
    }
    add({ kind: 'count' });
  }
  if (style === 'currency' || style === 'decimal' || ['sum', 'sum_distinct', 'average'].includes(current.kind)) {
    for (const path of ordered(numericPaths)) {
      add({ kind: 'sum', value: { kind: 'field', path } });
      if (table.groupBy.length > 0) {
        add({ kind: 'sum_distinct', value: { kind: 'field', path }, distinctBy: table.groupBy[0]!.value });
      }
      add({ kind: 'average', value: { kind: 'field', path } });
    }
  }
  if (style === 'text' || current.kind === 'first') {
    for (const path of ordered(identifierPaths)) add({ kind: 'first', value: { kind: 'field', path } });
  }
  return candidates;
}

/**
 * A derived table ratio can hide the aggregate columns that determine it, so
 * those source filters do not appear in the direct mismatch. Reuse an
 * already-evidenced aggregate predicate across the referenced hidden columns
 * and let exact replay decide whether the ratio's row subset is correct.
 */
export function applyAggregateFilterVariants(
  input: ReplayRepairInput,
  current: ReplayRepairResult,
): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  const filters = aggregateFilterCandidates(input.plan);
  if (filters.length === 0 || targets.tableIds.size === 0) return [];
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate' || !targets.tableIds.has(table.id)) continue;
    const badColumns = targets.tableColumns.get(table.id);
    if (!badColumns) continue;
    const referenced = new Set<string>();
    for (const column of table.columns) {
      if (!badColumns.has(column.id) || column.value.kind !== 'derived') continue;
      for (const columnId of aggregateColumnReferences(column.value.expression)) referenced.add(columnId);
    }
    const aggregateIds = new Set(table.columns.flatMap((column) => (
      referenced.has(column.id) && column.value.kind === 'aggregate' ? [column.id] : []
    )));
    if (aggregateIds.size === 0) continue;
    for (const filter of filters) {
      const nextTable = {
        ...table,
        columns: table.columns.map((column) => column.value.kind === 'aggregate' && aggregateIds.has(column.id)
          ? { ...column, value: { ...column.value, expression: withAggregateFilter(column.value.expression, filter) } }
          : column),
      };
      const plan = { ...input.plan, tables: input.plan.tables.map((candidate) => candidate.id === table.id ? nextTable : candidate) };
      const key = JSON.stringify(plan);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ ...input, plan });
      if (variants.length >= 48) return variants;
    }
  }
  return variants;
}

export function applyAggregateRepairVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate') continue;
    const columns = targets.tableColumns.get(table.id);
    if (!columns) continue;
    for (const column of table.columns) {
      if (!columns.has(column.id) || column.value.kind !== 'aggregate') continue;
      const expected = current.mismatches
        .filter((mismatch) => input.layout.tableBindings.some((binding) => (
          binding.tableId === table.id && binding.columns.some((candidate) => (
            candidate.columnId === column.id
            && input.pair.tableGroups.find((group) => group.id === binding.groupId)?.rows.some((row) => (
              row.cells[candidate.columnIndex]?.id === mismatch.slotId
            ))
          ))
        )))
        .map((mismatch) => mismatch.expected)
        .find((value) => value.length > 0);
      if (expected === undefined) continue;
      for (const expression of aggregateMetricCandidates(input, table, column.value, expected)) {
        const nextTable = {
          ...table,
          columns: table.columns.map((candidate) => candidate.id === column.id
            ? { ...candidate, value: { ...candidate.value, expression } }
            : candidate),
        };
        const plan = { ...input.plan, tables: input.plan.tables.map((candidate) => (
          candidate.id === table.id ? nextTable : candidate
        )) };
        const key = JSON.stringify(plan);
        if (seen.has(key)) continue;
        seen.add(key);
        variants.push({ ...input, plan });
        if (variants.length >= 96) return variants;
      }
    }
  }
  return variants;
}
