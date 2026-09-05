import { evaluateAggregate } from './aggregate.js';
import { formatReportValue } from './format.js';
import {
  ReportPlanSchema,
  type ReportAggregateTableSpec,
  type ReportOutputPredicate,
  type ReportOutputValueExpression,
  type ReportPlan,
  type ReportPrimitive,
  type ReportSortSpec,
  type ReportSourceSnapshot,
} from './schema.js';
import {
  asPrimitive,
  compareValues,
  comparable,
  evaluateOutputPredicate,
  evaluateOutputValue,
  evaluatePredicate,
  evaluateValue,
  valueAtPath,
  type ReportRow,
} from './value.js';

export interface ReportCell {
  raw: ReportPrimitive;
  display: string;
}

export interface ReportTableResult {
  columns: string[];
  rows: Array<{
    raw: Record<string, ReportPrimitive>;
    display: Record<string, string>;
  }>;
}

export interface ReportPlanResult {
  scalars: Record<string, ReportCell>;
  tables: Record<string, ReportTableResult>;
  texts: Record<string, string>;
}

function assertUnique(values: string[], code: string): void {
  if (new Set(values).size !== values.length) throw new Error(code);
}

function joinedRows(
  plan: ReportPlan,
  sources: Record<string, ReportSourceSnapshot>,
  metadata: Record<string, ReportPrimitive>,
): ReportRow[] {
  const requiredSources = [plan.baseSource, ...plan.joins.map((join) => join.source)];
  for (const sourceId of requiredSources) {
    const source = sources[sourceId];
    if (!source) throw new Error(`report_source_missing:${sourceId}`);
    if (!source.complete) throw new Error(`report_source_incomplete:${sourceId}`);
  }

  let rows: ReportRow[] = sources[plan.baseSource]!.rows.map((row) => ({
    [plan.baseSource]: row,
    meta: metadata,
  }));
  for (const join of plan.joins) {
    const candidates = sources[join.source]!.rows;
    const qualifiedPrefix = `${join.source}.`;
    const candidatePath = join.right.startsWith(qualifiedPrefix)
      ? join.right.slice(qualifiedPrefix.length)
      : join.right;
    if (!candidatePath) throw new Error(`report_join_right_path_invalid:${join.source}`);
    const index = new Map<ReturnType<typeof comparable>, ReportRow[]>();
    for (const candidate of candidates) {
      const key = comparable(valueAtPath(candidate, candidatePath));
      const bucket = index.get(key);
      if (bucket) bucket.push(candidate);
      else index.set(key, [candidate]);
    }
    const next: ReportRow[] = [];
    for (const row of rows) {
      const left = valueAtPath(row, join.left);
      const matches = (index.get(comparable(left)) ?? []).filter((candidate) => {
        return !join.where || evaluatePredicate(join.where, { ...row, [join.source]: candidate });
      });
      if (join.cardinality === 'one' && matches.length > 1) {
        throw new Error(`report_join_cardinality_violation:${join.source}`);
      }
      if (matches.length === 0) {
        if (join.type === 'left') next.push({ ...row, [join.source]: null });
        continue;
      }
      for (const match of matches) {
        if (next.length >= 100_000) throw new Error('report_join_row_limit');
        next.push({ ...row, [join.source]: match });
      }
    }
    rows = next;
  }
  return plan.filter ? rows.filter((row) => evaluatePredicate(plan.filter!, row)) : rows;
}

function stableGroupKey(values: ReportPrimitive[]): string {
  return JSON.stringify(values.map((value) => [typeof value, value]));
}

function sortRows<T extends { raw: Record<string, ReportPrimitive> }>(rows: T[], sort: ReportSortSpec[] = []): T[] {
  const sorted = [...rows];
  sorted.sort((left, right) => {
    for (const rule of sort) {
      const a = left.raw[rule.columnId];
      const b = right.raw[rule.columnId];
      if (compareValues('eq', a, b)) continue;
      const order = compareValues('lt', a, b) ? -1 : 1;
      return rule.direction === 'asc' ? order : -order;
    }
    return JSON.stringify(left.raw).localeCompare(JSON.stringify(right.raw));
  });
  return sorted;
}

function outputValueColumns(expression: ReportOutputValueExpression): string[] {
  switch (expression.kind) {
    case 'column': return [expression.columnId];
    case 'literal': return [];
    case 'arithmetic': return [...outputValueColumns(expression.left), ...outputValueColumns(expression.right)];
    case 'coalesce':
    case 'concat': return expression.values.flatMap(outputValueColumns);
    case 'case': return [
      ...expression.branches.flatMap((branch) => [
        ...outputPredicateColumns(branch.when),
        ...outputValueColumns(branch.value),
      ]),
      ...outputValueColumns(expression.fallback),
    ];
  }
}

function outputPredicateColumns(predicate: ReportOutputPredicate): string[] {
  switch (predicate.kind) {
    case 'compare': return [...outputValueColumns(predicate.left), ...outputValueColumns(predicate.right)];
    case 'in': return [...outputValueColumns(predicate.value), ...predicate.values.flatMap(outputValueColumns)];
    case 'and':
    case 'or': return predicate.items.flatMap(outputPredicateColumns);
    case 'not': return outputPredicateColumns(predicate.item);
    case 'is_null': return outputValueColumns(predicate.value);
  }
}

function assertColumnsExist(requested: string[], available: Set<string>, code: string): void {
  const missing = [...new Set(requested)].filter((column) => !available.has(column));
  if (missing.length > 0) throw new Error(`${code}:${missing.join(',')}`);
}

function aggregateTable(spec: ReportAggregateTableSpec, rows: ReportRow[]): ReportTableResult {
  assertUnique(spec.groupBy.map((key) => key.id), `report_duplicate_group_key:${spec.id}`);
  assertUnique(spec.columns.map((column) => column.id), `report_duplicate_table_column:${spec.id}`);
  const declaredColumnIds = new Set(spec.columns.map((column) => column.id));
  assertColumnsExist((spec.sort ?? []).map((rule) => rule.columnId), declaredColumnIds, `report_sort_column_missing:${spec.id}`);
  const selected = spec.filter ? rows.filter((row) => evaluatePredicate(spec.filter!, row)) : rows;
  const groups = new Map<string, { keys: Record<string, ReportPrimitive>; rows: ReportRow[] }>();
  for (const row of selected) {
    const keyValues = spec.groupBy.map((key) => asPrimitive(evaluateValue(key.value, row), `${spec.id}.${key.id}`));
    const id = stableGroupKey(keyValues);
    const existing = groups.get(id);
    if (existing) {
      existing.rows.push(row);
    } else {
      groups.set(id, {
        keys: Object.fromEntries(spec.groupBy.map((key, index) => [key.id, keyValues[index]!])),
        rows: [row],
      });
    }
  }

  const materialized = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => {
      const raw: Record<string, ReportPrimitive> = {};
      const display: Record<string, string> = {};
      const available = new Set<string>();
      for (const column of spec.columns) {
        if (column.value.kind === 'derived') {
          assertColumnsExist(
            outputValueColumns(column.value.expression),
            available,
            `report_derived_column_dependency_missing:${spec.id}.${column.id}`,
          );
        }
        const value = column.value.kind === 'group_key'
          ? group.keys[column.value.keyId]
          : column.value.kind === 'aggregate'
            ? evaluateAggregate(column.value.expression, group.rows)
            : asPrimitive(evaluateOutputValue(column.value.expression, raw), `${spec.id}.${column.id}`);
        if (value === undefined) throw new Error(`report_group_key_missing:${spec.id}.${column.id}`);
        raw[column.id] = value;
        display[column.id] = formatReportValue(value, column.format);
        available.add(column.id);
      }
      return { raw, display };
    });
  const limited = sortRows(materialized, spec.sort).slice(0, spec.limit ?? materialized.length);
  return { columns: spec.columns.map((column) => column.id), rows: limited };
}

function renderTexts(
  plan: ReportPlan,
  scalars: ReportPlanResult['scalars'],
  tables: ReportPlanResult['tables'],
  metadata: Record<string, ReportPrimitive>,
): Record<string, string> {
  const renderTemplate = (template: string): string => template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_match, rawToken: string) => {
    const token = rawToken.trim();
    if (token.startsWith('scalar.')) {
      const scalar = scalars[token.slice('scalar.'.length)];
      if (!scalar) throw new Error(`report_text_reference_missing:${token}`);
      return scalar.display;
    }
    if (token.startsWith('meta.')) {
      const value = metadata[token.slice('meta.'.length)];
      if (value === undefined) throw new Error(`report_text_reference_missing:${token}`);
      return String(value ?? '');
    }
    const tableMatch = token.match(/^table\.([^.]+)\.rowCount$/);
    if (tableMatch) {
      const table = tables[tableMatch[1]!];
      if (!table) throw new Error(`report_text_reference_missing:${token}`);
      return String(table.rows.length);
    }
    throw new Error(`report_text_reference_invalid:${token}`);
  });
  const texts: Record<string, string> = {};
  for (const spec of plan.texts) {
    if (spec.kind === 'computed') {
      texts[spec.id] = renderTemplate(spec.template);
      continue;
    }
    if (spec.kind === 'invariant') {
      texts[spec.id] = spec.value;
      continue;
    }
    const phase = metadata.reportPhase;
    if (phase === 'example') {
      texts[spec.id] = spec.exampleValue;
      continue;
    }
    if (phase !== 'target') throw new Error('report_text_phase_missing');
    const value = metadata[spec.targetMetadataKey];
    if (value === undefined) throw new Error(`report_text_reference_missing:meta.${spec.targetMetadataKey}`);
    texts[spec.id] = String(value ?? '');
  }
  return texts;
}

export function executeReportPlan(
  input: ReportPlan,
  sources: Record<string, ReportSourceSnapshot>,
  metadata: Record<string, ReportPrimitive> = {},
): ReportPlanResult {
  const plan = ReportPlanSchema.parse(input);
  assertUnique(plan.scalars.map((scalar) => scalar.id), 'report_duplicate_scalar');
  assertUnique(plan.tables.map((table) => table.id), 'report_duplicate_table');
  assertUnique(plan.texts.map((text) => text.id), 'report_duplicate_text');
  const rows = joinedRows(plan, sources, metadata);

  const scalars: ReportPlanResult['scalars'] = {};
  for (const scalar of plan.scalars) {
    const raw = evaluateAggregate(scalar.expression, rows);
    scalars[scalar.id] = { raw, display: formatReportValue(raw, scalar.format) };
  }

  const tables: ReportPlanResult['tables'] = {};
  for (const table of plan.tables) {
    if (table.kind === 'aggregate') {
      tables[table.id] = aggregateTable(table, rows);
      continue;
    }
    const source = tables[table.sourceTable];
    if (!source) throw new Error(`report_view_source_missing:${table.sourceTable}`);
    const columns = table.columns ?? source.columns;
    const available = new Set(source.columns);
    assertColumnsExist(columns, available, `report_view_column_missing:${table.id}`);
    assertColumnsExist((table.sort ?? []).map((rule) => rule.columnId), available, `report_sort_column_missing:${table.id}`);
    if (table.filter) {
      assertColumnsExist(outputPredicateColumns(table.filter), available, `report_view_filter_column_missing:${table.id}`);
    }
    const selected = source.rows
      .filter((row) => !table.filter || evaluateOutputPredicate(table.filter, row.raw))
      .map((row) => ({
        raw: Object.fromEntries(columns.map((column) => [column, row.raw[column] ?? null])),
        display: Object.fromEntries(columns.map((column) => [column, row.display[column] ?? ''])),
      }));
    const materialized = sortRows(selected, table.sort).slice(0, table.limit ?? selected.length);
    tables[table.id] = { columns, rows: materialized };
  }

  return {
    scalars,
    tables,
    texts: renderTexts(plan, scalars, tables, metadata),
  };
}
