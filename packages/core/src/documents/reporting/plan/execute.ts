import { evaluateAggregate } from './aggregate.js';
import { formatReportValue } from './format.js';
import {
  ReportPlanSchema,
  type ReportAggregateTableSpec,
  type ReportDerivedExpression,
  type ReportDerivedPredicate,
  isReportAggregateExpression,
  type ReportOutputPredicate,
  type ReportOutputValueExpression,
  type ReportPlan,
  type ReportDataset,
  type ReportPrimitive,
  type ReportScalarExpression,
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
  evaluateArithmetic,
  fieldPaths,
  numericValue,
  valueAtPath,
  type ReportRow,
} from './value.js';

interface ReportCell {
  raw: ReportPrimitive;
  display: string;
}

interface ReportTableResult {
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

function assertDatasetFieldSourcesJoined(plan: ReportPlan, knownSourceAliases: Set<string>): void {
  const datasets: Array<{ id?: string; dataset: ReportDataset; fragments: unknown[] }> = [
    {
      dataset: plan,
      fragments: [plan.filter, ...plan.joins.map((join) => join.where)],
    },
    ...(plan.datasets ?? []).map((dataset) => ({
      id: dataset.id,
      dataset,
      fragments: [dataset.filter, ...dataset.joins.map((join) => join.where)],
    })),
  ];
  const fragmentsById = new Map<string | undefined, unknown[]>(
    datasets.map(({ id, fragments }) => [id, fragments]),
  );
  for (const scalar of plan.scalars) {
    fragmentsById.get(scalar.dataset)?.push(scalar.expression);
  }
  for (const table of plan.tables) {
    if (table.kind !== 'aggregate') continue;
    const fragments = fragmentsById.get(table.dataset);
    if (!fragments) continue;
    fragments.push(table.filter, table.groupBy, table.columns);
  }
  for (const { id, dataset, fragments } of datasets) {
    const available = new Set(['meta', dataset.baseSource, ...dataset.joins.map((join) => join.source)]);
    for (const path of fieldPaths(fragments)) {
      const parts = path.split('.');
      let referencedSource = parts[0]!;
      // normalizeFieldPath prefixes an unknown shorthand with the dataset
      // base source. If the next segment is a captured source alias, retain
      // the actionable missing-join diagnosis instead of silently evaluating
      // `baseAlias.joinedAlias.field` as a nested source-row field.
      if (available.has(referencedSource) && parts.length > 2
        && knownSourceAliases.has(parts[1]!) && !available.has(parts[1]!)) {
        referencedSource = parts[1]!;
      }
      if (knownSourceAliases.has(referencedSource) && !available.has(referencedSource)) {
        throw new Error(`report_plan_field_source_not_joined:${id ?? 'root'}.${referencedSource}`);
      }
    }
  }
}

/** Validate that field expressions cannot silently read an unjoined source. */
export function assertReportPlanFieldSourcesJoined(
  plan: ReportPlan,
  sourceAliases: Iterable<string> = [],
): void {
  const parsed = ReportPlanSchema.parse(plan);
  assertDatasetFieldSourcesJoined(parsed, new Set(sourceAliases));
}

function joinedRows(
  plan: ReportDataset,
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

function evaluateScalarExpression(
  expression: ReportScalarExpression,
  rows: ReportRow[],
  metadata: Record<string, ReportPrimitive>,
  id: string,
): ReportPrimitive {
  if (isReportAggregateExpression(expression)) return evaluateAggregate(expression, rows);
  // Value expressions are intended for metadata-backed scalar slots. Use a
  // metadata-only row when the selected dataset is empty, and the first joined
  // row otherwise; aggregation remains explicit through `count`/`first`.
  const row = rows[0] ?? { meta: metadata };
  switch (expression.kind) {
    case 'field':
    case 'literal':
      return asPrimitive(evaluateValue(expression, row), `scalar.${id}`);
    case 'arithmetic':
      return evaluateArithmetic(
        expression.operation,
        numericValue(evaluateScalarExpression(expression.left, rows, metadata, `${id}.left`), `scalar.${id}.left`),
        numericValue(evaluateScalarExpression(expression.right, rows, metadata, `${id}.right`), `scalar.${id}.right`),
      );
    case 'coalesce':
      for (const item of expression.values) {
        const value = evaluateScalarExpression(item, rows, metadata, id);
        if (value !== null && value !== undefined && value !== '') return value;
      }
      return null;
    case 'concat':
      return expression.values
        .map((item) => evaluateScalarExpression(item, rows, metadata, id))
        .filter((value) => value !== null && value !== undefined)
        .map(String)
        .join(expression.separator ?? '');
  }
}

function derivedPredicateColumns(predicate: ReportDerivedPredicate | ReportOutputPredicate): string[] {
  switch (predicate.kind) {
    case 'compare':
      return [
        ...derivedOutputColumns(predicate.left as ReportDerivedExpression),
        ...derivedOutputColumns(predicate.right as ReportDerivedExpression),
      ];
    case 'in':
      return [
        ...derivedOutputColumns(predicate.value as ReportDerivedExpression),
        ...predicate.values.flatMap((value) => derivedOutputColumns(value as ReportDerivedExpression)),
      ];
    case 'and':
    case 'or':
      return predicate.items.flatMap((item) => derivedPredicateColumns(item));
    case 'not':
      return derivedPredicateColumns(predicate.item);
    case 'is_null':
      return derivedOutputColumns(predicate.value as ReportDerivedExpression);
  }
}

function derivedOutputColumns(expression: ReportDerivedExpression): string[] {
  if (isReportAggregateExpression(expression)) return [];
  switch (expression.kind) {
    case 'column': return [expression.columnId];
    case 'scalar': return [];
    case 'literal': return [];
    case 'arithmetic':
      return [...derivedOutputColumns(expression.left), ...derivedOutputColumns(expression.right)];
    case 'coalesce':
    case 'concat':
      return expression.values.flatMap(derivedOutputColumns);
    case 'case':
      return [
        ...expression.branches.flatMap((branch) => [
          ...derivedPredicateColumns(branch.when),
          ...derivedOutputColumns(branch.value),
        ]),
        ...derivedOutputColumns(expression.fallback),
      ];
  }
}

function assertColumnsExist(requested: string[], available: Set<string>, code: string): void {
  const missing = [...new Set(requested)].filter((column) => !available.has(column));
  if (missing.length > 0) throw new Error(`${code}:${missing.join(',')}`);
}

function evaluateDerivedExpression(
  expression: ReportDerivedExpression,
  raw: Record<string, ReportPrimitive>,
  rows: ReportRow[],
  scalarValues: Record<string, ReportPrimitive>,
  groupKeys: Record<string, ReportPrimitive>,
  context: string,
): ReportPrimitive {
  if (isReportAggregateExpression(expression)) return evaluateAggregate(expression, rows);
  switch (expression.kind) {
    case 'scalar': {
      if (!Object.hasOwn(scalarValues, expression.scalarId)) {
        throw new Error(`report_scalar_reference_missing:${expression.scalarId}`);
      }
      return scalarValues[expression.scalarId]!;
    }
    case 'column':
    case 'literal':
      return asPrimitive(evaluateOutputValue(expression, { ...groupKeys, ...raw }), context);
    case 'arithmetic':
      return evaluateArithmetic(
        expression.operation,
        numericValue(evaluateDerivedExpression(expression.left, raw, rows, scalarValues, groupKeys, `${context}.left`), `${context}.left`),
        numericValue(evaluateDerivedExpression(expression.right, raw, rows, scalarValues, groupKeys, `${context}.right`), `${context}.right`),
      );
    case 'coalesce':
      for (const item of expression.values) {
        const value = evaluateDerivedExpression(item, raw, rows, scalarValues, groupKeys, context);
        if (value !== null && value !== undefined && value !== '') return value;
      }
      return null;
    case 'concat':
      return expression.values
        .map((item) => evaluateDerivedExpression(item, raw, rows, scalarValues, groupKeys, context))
        .filter((value) => value !== null && value !== undefined)
        .map(String)
        .join(expression.separator ?? '');
    case 'case':
      for (const branch of expression.branches) {
        if (evaluateDerivedPredicate(branch.when, raw, rows, scalarValues, groupKeys, context)) {
          return evaluateDerivedExpression(branch.value, raw, rows, scalarValues, groupKeys, context);
        }
      }
      return evaluateDerivedExpression(expression.fallback, raw, rows, scalarValues, groupKeys, context);
  }
}

function evaluateDerivedPredicate(
  predicate: ReportDerivedPredicate | ReportOutputPredicate,
  raw: Record<string, ReportPrimitive>,
  rows: ReportRow[],
  scalarValues: Record<string, ReportPrimitive>,
  groupKeys: Record<string, ReportPrimitive>,
  context: string,
): boolean {
  switch (predicate.kind) {
    case 'compare':
      return compareValues(
        predicate.operation,
        evaluateDerivedExpression(predicate.left as ReportDerivedExpression, raw, rows, scalarValues, groupKeys, `${context}.left`),
        evaluateDerivedExpression(predicate.right as ReportDerivedExpression, raw, rows, scalarValues, groupKeys, `${context}.right`),
      );
    case 'in': {
      const value = evaluateDerivedExpression(predicate.value as ReportDerivedExpression, raw, rows, scalarValues, groupKeys, `${context}.value`);
      return predicate.values.some((candidate) => compareValues(
        'eq',
        value,
        evaluateDerivedExpression(candidate as ReportDerivedExpression, raw, rows, scalarValues, groupKeys, `${context}.candidate`),
      ));
    }
    case 'and': return predicate.items.every((item) => evaluateDerivedPredicate(item, raw, rows, scalarValues, groupKeys, context));
    case 'or': return predicate.items.some((item) => evaluateDerivedPredicate(item, raw, rows, scalarValues, groupKeys, context));
    case 'not': return !evaluateDerivedPredicate(predicate.item, raw, rows, scalarValues, groupKeys, context);
    case 'is_null': {
      const value = evaluateDerivedExpression(predicate.value as ReportDerivedExpression, raw, rows, scalarValues, groupKeys, `${context}.value`);
      const isNull = value == null;
      return predicate.negate ? !isNull : isNull;
    }
  }
}

function aggregateTable(
  spec: ReportAggregateTableSpec,
  rows: ReportRow[],
  scalarValues: Record<string, ReportPrimitive>,
): ReportTableResult {
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
      // Group keys are valid inputs to a derived cell even when the model did
      // not repeat them as visible columns. Keep them available for dependency
      // checks and evaluation without leaking them into the materialized row.
      const available = new Set<string>(Object.keys(group.keys));
      for (const column of spec.columns) {
        if (column.value.kind === 'derived') {
          assertColumnsExist(
            derivedOutputColumns(column.value.expression),
            available,
            `report_derived_column_dependency_missing:${spec.id}.${column.id}`,
          );
        }
        const value = column.value.kind === 'group_key'
          ? group.keys[column.value.keyId]
          : column.value.kind === 'aggregate'
            ? evaluateAggregate(column.value.expression, group.rows)
          : evaluateDerivedExpression(column.value.expression, raw, group.rows, scalarValues, group.keys, `${spec.id}.${column.id}`);
        if (value === undefined) throw new Error(`report_group_key_missing:${spec.id}.${column.id}`);
        raw[column.id] = value;
        display[column.id] = formatReportValue(value, column.format);
        available.add(column.id);
      }
      return { raw, display };
    });
  const havingColumns = spec.having ? outputPredicateColumns(spec.having) : [];
  assertColumnsExist(havingColumns, new Set(spec.columns.map((column) => column.id)), `report_having_column_missing:${spec.id}`);
  const filtered = spec.having
    ? materialized.filter((row) => evaluateOutputPredicate(spec.having!, row.raw))
    : materialized;
  const limited = sortRows(filtered, spec.sort).slice(0, spec.limit ?? filtered.length);
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
  assertDatasetFieldSourcesJoined(plan, new Set(Object.keys(sources)));
  assertUnique(plan.scalars.map((scalar) => scalar.id), 'report_duplicate_scalar');
  assertUnique(plan.tables.map((table) => table.id), 'report_duplicate_table');
  assertUnique(plan.texts.map((text) => text.id), 'report_duplicate_text');
  assertUnique((plan.datasets ?? []).map(dataset => dataset.id), 'report_duplicate_dataset');
  const datasets = new Map((plan.datasets ?? []).map(dataset => [dataset.id, dataset]));
  const materialized = new Map<string | undefined, ReportRow[]>();
  const rowsFor = (id?: string): ReportRow[] => {
    const cached = materialized.get(id);
    if (cached) return cached;
    const dataset = id === undefined ? plan : datasets.get(id);
    if (!dataset) throw new Error(`report_dataset_missing:${id}`);
    const rows = joinedRows(dataset, sources, metadata);
    materialized.set(id, rows);
    return rows;
  };

  const scalars: ReportPlanResult['scalars'] = {};
  for (const scalar of plan.scalars) {
    const raw = evaluateScalarExpression(scalar.expression, rowsFor(scalar.dataset), metadata, scalar.id);
    scalars[scalar.id] = { raw, display: formatReportValue(raw, scalar.format) };
  }
  const scalarValues = Object.fromEntries(
    Object.entries(scalars).map(([id, cell]) => [id, cell.raw]),
  ) as Record<string, ReportPrimitive>;

  const tables: ReportPlanResult['tables'] = {};
  for (const table of plan.tables) {
    if (table.kind === 'aggregate') {
      tables[table.id] = aggregateTable(table, rowsFor(table.dataset), scalarValues);
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
      .filter((row) => !table.filter || evaluateOutputPredicate(table.filter, row.raw));
    const materialized = sortRows(selected, table.sort)
      .slice(0, table.limit ?? selected.length)
      .map((row) => ({
        raw: Object.fromEntries(columns.map((column) => [column, row.raw[column] ?? null])),
        display: Object.fromEntries(columns.map((column) => [column, row.display[column] ?? ''])),
      }));
    tables[table.id] = { columns, rows: materialized };
  }

  return {
    scalars,
    tables,
    texts: renderTexts(plan, scalars, tables, metadata),
  };
}
