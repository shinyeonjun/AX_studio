import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../layout/schema.js';
import type {
  ReportAggregateColumnValue,
  ReportAggregateExpression,
  ReportDerivedExpression,
  ReportFormat,
  ReportPlan,
  ReportPredicate,
  ReportPrimitive,
  ReportScalarExpression,
  ReportSourceSnapshot,
  ReportValueExpression,
} from '../plan/schema.js';
import { executeReportPlan } from '../plan/execute.js';
import { fieldPaths, isRecordValue, valueAtPath } from '../plan/value.js';
import { normalizeReportText } from '../plan/reusability.js';
import { materializeReportLayout, verifyReportExampleReplay } from '../layout/materialize.js';

export function formatFromExampleText(value: string): ReportFormat | undefined {
  const text = normalizeReportText(value);
  const numericPattern = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  if (new RegExp(`^KRW\\s*${numericPattern}$`, 'iu').test(text)) {
    return { style: 'currency', currency: 'KRW', decimals: text.includes('.') ? text.split('.').at(-1)!.length : 0 };
  }
  if (new RegExp(`^(?:₩|\\$|€|£)\\s*${numericPattern}$`, 'u').test(text)) {
    const decimals = text.includes('.') ? text.split('.').at(-1)!.length : 0;
    const currency = text.trimStart().at(0) === '₩' ? 'KRW' : undefined;
    return { style: 'currency', ...(currency ? { currency } : {}), decimals };
  }
  if (new RegExp(`^${numericPattern}\\s*(?:원|KRW)$`, 'iu').test(text)) {
    const numeric = text.replace(/(?:원|KRW)$/iu, '').trim();
    const decimals = numeric.includes('.') ? numeric.split('.').at(-1)!.length : 0;
    return { style: 'currency', currency: 'KRW', decimals };
  }
  if (new RegExp(`^${numericPattern}\\s*%$`, 'u').test(text)) {
    const numeric = text.slice(0, -1).replace(/,/g, '').trim();
    const decimals = numeric.includes('.') ? numeric.split('.').at(-1)!.length : 0;
    return { style: 'percent', decimals };
  }
  if (new RegExp(`^${numericPattern}$`, 'u').test(text)) {
    return { style: text.includes('.') ? 'decimal' : 'integer', ...(text.includes('.') ? { decimals: text.split('.').at(-1)!.length } : {}) };
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return { style: 'date' };
  return undefined;
}

export interface ReplayRepairInput {
  plan: ReportPlan;
  layout: ReportLayoutPlan;
  pair: PdfReportPairAnalysis;
  sources: Record<string, ReportSourceSnapshot>;
  metadata: Record<string, ReportPrimitive>;
}

export interface ReplayRepairResult {
  plan: ReportPlan;
  layout: ReportLayoutPlan;
  mismatches: Array<{ slotId: string; expected: string; actual: string }>;
  /** Set only for the initial plan when replay could not be executed. */
  executionError?: string;
}

function replayRepairResult(input: ReplayRepairInput, preserveExecutionError = false): ReplayRepairResult | undefined {
  try {
    const result = executeReportPlan(input.plan, input.sources, input.metadata);
    const materialized = materializeReportLayout(input.pair, input.layout, result, input.metadata);
    return { ...input, mismatches: verifyReportExampleReplay(input.pair, materialized.values).mismatches };
  } catch (error) {
    if (preserveExecutionError) {
      const message = error instanceof Error ? error.message : 'report_replay_unavailable';
      return { ...input, mismatches: [], executionError: message.startsWith('report_') ? message.slice(0, 300) : 'report_replay_unavailable' };
    }
    return undefined;
  }
}

/**
 * Models may emit a derived table column before the aggregate columns it
 * references. The plan is still declarative and unambiguous, so normalize the
 * declaration order once. Layout column indices refer to template positions,
 * while column ids select result values, so they remain unchanged.
 * Unknown references and cycles are left for the executor to reject.
 */
function repairDerivedColumnOrder(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  let planChanged = false;
  const nextTables = plan.tables.map((table) => {
    if (table.kind !== 'aggregate' || table.columns.length < 2) return table;
    const originalIndex = new Map(table.columns.map((column, index) => [column.id, index]));
    const columnIds = new Set(table.columns.map((column) => column.id));
    const dependencies = new Map(table.columns.map((column) => [
      column.id,
      column.value.kind === 'derived'
        ? new Set([...aggregateColumnReferences(column.value.expression)].filter((id) => columnIds.has(id)))
        : new Set<string>(),
    ]));
    const remaining = new Set(table.columns.map((column) => column.id));
    const orderedIds: string[] = [];
    while (remaining.size > 0) {
      const ready = [...remaining]
        .filter((id) => [...(dependencies.get(id) ?? [])].every((dependency) => !remaining.has(dependency)))
        .sort((left, right) => (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0));
      if (ready.length === 0) return table;
      const next = ready[0]!;
      orderedIds.push(next);
      remaining.delete(next);
    }
    if (orderedIds.every((id, index) => id === table.columns[index]?.id)) return table;
    planChanged = true;
    const columns = orderedIds.map((id) => table.columns[originalIndex.get(id)!]!);
    return { ...table, columns };
  });
  if (!planChanged) return { plan, layout };
  return { plan: { ...plan, tables: nextTables }, layout };
}

function simpleRatio(value: unknown): { left: unknown; right: unknown } | undefined {
  if (!isRecordValue(value) || value.kind !== 'arithmetic' || value.operation !== 'divide') return undefined;
  if (!isRecordValue(value.left) || !isRecordValue(value.right)) return undefined;
  if (!['sum', 'sum_distinct'].includes(String(value.left.kind))) return undefined;
  const denominatorHasAggregate = (candidate: unknown): boolean => (
    isRecordValue(candidate) && (
      ['sum', 'sum_distinct'].includes(String(candidate.kind))
      || (candidate.kind === 'arithmetic'
        && denominatorHasAggregate(candidate.left)
        && denominatorHasAggregate(candidate.right))
    )
  );
  if (!denominatorHasAggregate(value.right)) return undefined;
  return { left: value.left, right: value.right };
}

function ratioSignature(value: unknown): string | undefined {
  const ratio = simpleRatio(value);
  return ratio ? JSON.stringify(ratio.left) : undefined;
}

function rewriteRatios(
  value: unknown,
  signatures: ReadonlySet<string>,
  denominator: ReportAggregateExpression,
  filter?: ReportPredicate,
): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteRatios(item, signatures, denominator, filter));
  if (!isRecordValue(value)) return value;
  const ratio = simpleRatio(value);
  if (ratio && signatures.has(JSON.stringify(ratio.left))) {
    return {
      ...value,
      ...(filter ? { left: withAggregateFilter(ratio.left as ReportAggregateExpression, filter) } : {}),
      right: filter ? withAggregateFilter(denominator, filter) : denominator,
    };
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, rewriteRatios(child, signatures, denominator, filter),
  ]));
}

function aggregateFilterCandidates(plan: ReportPlan): ReportPredicate[] {
  const filters: ReportPredicate[] = [];
  const seen = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isRecordValue(value)) return;
    const kind = typeof value.kind === 'string' ? value.kind : undefined;
    const where = value.where;
    if (kind && ['count', 'count_distinct', 'sum', 'sum_distinct', 'average', 'min', 'max', 'first'].includes(kind)
      && isRecordValue(where)) {
      const key = JSON.stringify(where);
      if (!seen.has(key)) {
        seen.add(key);
        filters.push(where as ReportPredicate);
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(plan);
  return filters.slice(0, 8);
}

function predicateSpecificity(filter: ReportPredicate | undefined): number {
  if (!filter) return 0;
  let score = 0;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!isRecordValue(value)) return;
    if (value.kind === 'in') score += 3;
    if (value.kind === 'compare') score += 1;
    Object.values(value).forEach(visit);
  };
  visit(filter);
  return score;
}

/** Collect every predicate already evidenced by the reusable plan. Dataset
 * filters describe the row population, while aggregate `where` clauses
 * describe a metric subset; both are safe candidates for a ratio repair when
 * replay proves that the numerator and denominator share that population. */
function replayPredicateCandidates(plan: ReportPlan): Array<ReportPredicate | undefined> {
  const filters: Array<ReportPredicate | undefined> = [undefined];
  const seen = new Set<string>([stableJson(undefined)]);
  const add = (filter: unknown): void => {
    if (!isRecordValue(filter)) return;
    const predicate = filter as ReportPredicate;
    const key = stableJson(predicate);
    if (seen.has(key)) return;
    seen.add(key);
    filters.push(predicate);
  };
  for (const dataset of plan.datasets ?? []) add(dataset.filter);
  add(plan.filter);
  for (const table of plan.tables) {
    if (table.kind === 'aggregate') add(table.filter);
  }
  for (const filter of aggregateFilterCandidates(plan)) add(filter);
  return filters.sort((left, right) => predicateSpecificity(right) - predicateSpecificity(left));
}

function numericEvidenceValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/,/gu, '').trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numericSourceFields(sources: Record<string, ReportSourceSnapshot>, preferred: string[] = []): string[] {
  const counts = new Map<string, number>();
  for (const [alias, snapshot] of Object.entries(sources)) {
    for (const row of snapshot.rows) {
      for (const [field, value] of Object.entries(row)) {
        if (numericEvidenceValue(value) === undefined) continue;
        const path = `${alias}.${field}`;
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }
  }
  const preferredSet = new Set(preferred);
  return [...counts.keys()].sort((left, right) => (
    Number(preferredSet.has(right)) - Number(preferredSet.has(left)) || left.localeCompare(right)
  )).slice(0, 16);
}

function ratioDenominatorCandidates(
  sources: Record<string, ReportSourceSnapshot>,
  current: unknown,
): ReportAggregateExpression[] {
  const preferred: string[] = [];
  const collectFields = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(collectFields);
    if (!isRecordValue(value)) return;
    if (value.kind === 'field' && typeof value.path === 'string') preferred.push(value.path);
    Object.values(value).forEach(collectFields);
  };
  collectFields(current);
  const fields = numericSourceFields(sources, preferred);
  const semanticFields = fields.filter((path) => /(?:net|refund|gross|discount|sales|revenue|amount|total)/iu.test(path));
  const orderedFields = [...new Set([...semanticFields, ...fields])];
  const values: ReportAggregateExpression[] = [];
  const seen = new Set<string>();
  const add = (expression: ReportAggregateExpression): void => {
    const key = JSON.stringify(expression);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(expression);
    }
  };
  const sum = (value: ReportValueExpression): ReportAggregateExpression => ({ kind: 'sum', value });
  const field = (path: string): ReportValueExpression => ({ kind: 'field', path });
  const findSemanticField = (pattern: RegExp): string | undefined => orderedFields.find((path) => pattern.test(path));
  const net = findSemanticField(/(?:^|[_.])net(?:_|$)/iu);
  const refund = findSemanticField(/(?:^|[_.])refund(?:_|$)/iu);
  const gross = findSemanticField(/(?:^|[_.])gross(?:_|$)/iu);
  const discount = findSemanticField(/(?:^|[_.])discount(?:_|$)/iu);
  // Common financial identities are tried before the broad numeric search.
  // This prevents a large source catalog from consuming the bounded ratio
  // candidate budget before the business formula can be replayed.
  if (net && refund) {
    add(sum({ kind: 'arithmetic', operation: 'add', left: field(net), right: field(refund) }));
  }
  if (gross && discount) {
    add(sum({ kind: 'arithmetic', operation: 'subtract', left: field(gross), right: field(discount) }));
  }
  const addPairs = (paths: string[]): void => {
    for (let left = 0; left < paths.length; left += 1) {
      for (let right = left + 1; right < paths.length; right += 1) {
        add(sum({ kind: 'arithmetic', operation: 'subtract', left: field(paths[left]!), right: field(paths[right]!) }));
        add(sum({ kind: 'arithmetic', operation: 'subtract', left: field(paths[right]!), right: field(paths[left]!) }));
        add(sum({ kind: 'arithmetic', operation: 'add', left: field(paths[left]!), right: field(paths[right]!) }));
      }
    }
  };
  addPairs(semanticFields);
  addPairs(orderedFields);
  for (const path of fields) add(sum(field(path)));
  return values;
}

function mismatchedReplayTargets(
  pair: PdfReportPairAnalysis,
  layout: ReportLayoutPlan,
  mismatches: Array<{ slotId: string; expected: string; actual: string }>,
): { scalarIds: Set<string>; tableColumns: Map<string, Set<string>>; tableIds: Set<string> } {
  const badSlots = new Set(mismatches.map((mismatch) => mismatch.slotId));
  const scalarIds = new Set<string>();
  for (const binding of layout.scalarBindings) {
    if (badSlots.has(binding.slotId) && binding.value.kind === 'scalar') scalarIds.add(binding.value.id);
  }
  const groups = new Map(pair.tableGroups.map((group) => [group.id, group]));
  const tableColumns = new Map<string, Set<string>>();
  const tableIds = new Set<string>();
  for (const binding of layout.tableBindings) {
    const group = groups.get(binding.groupId);
    if (!group) continue;
    for (const column of binding.columns) {
      if (!group.rows.some((row) => badSlots.has(row.cells[column.columnIndex]?.id ?? ''))) continue;
      const columns = tableColumns.get(binding.tableId) ?? new Set<string>();
      columns.add(column.columnId);
      tableColumns.set(binding.tableId, columns);
      tableIds.add(binding.tableId);
    }
  }
  return { scalarIds, tableColumns, tableIds };
}

function applyRatioRepairVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  const signatures = new Set<string>();
  for (const scalar of input.plan.scalars) {
    if (!targets.scalarIds.has(scalar.id)) continue;
    const signature = ratioSignature(scalar.expression);
    if (signature) signatures.add(signature);
  }
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate') continue;
    const columns = targets.tableColumns.get(table.id);
    if (!columns) continue;
    for (const column of table.columns) {
      if (!columns.has(column.id) || column.value.kind !== 'derived') continue;
      const signature = ratioSignature(column.value.expression);
      if (signature) signatures.add(signature);
    }
  }
  if (signatures.size === 0) return [];
  const variants: ReplayRepairInput[] = [];
  const existing = new Set<string>();
  const filters = replayPredicateCandidates(input.plan);
  for (const denominator of ratioDenominatorCandidates(input.sources, input.plan)) {
    for (const filter of filters) {
      const plan = rewriteRatios(input.plan, signatures, denominator, filter) as ReportPlan;
      const key = JSON.stringify(plan);
      if (existing.has(key)) continue;
      existing.add(key);
      variants.push({ ...input, plan });
      if (variants.length >= 96) return variants;
    }
  }
  return variants;
}

function structuralConcatSuffix(expected: string, actual: string): string | undefined {
  const expectedText = normalizeReportText(expected);
  const actualText = normalizeReportText(actual);
  if (!expectedText.startsWith(actualText)) return undefined;
  const suffix = expectedText.slice(actualText.length);
  if (!suffix || suffix.length > 20 || /[\p{L}\p{N}]/u.test(suffix)) return undefined;
  return suffix;
}

function structuralConcatExtra(expected: string, actual: string): string | undefined {
  const expectedText = normalizeReportText(expected);
  const actualText = normalizeReportText(actual);
  if (!actualText.startsWith(expectedText)) return undefined;
  const extra = actualText.slice(expectedText.length);
  if (!extra || extra.length > 20 || /[\p{L}\p{N}]/u.test(extra)) return undefined;
  return extra;
}

function structuralConcatGap(expected: string, actual: string): string | undefined {
  const expectedText = normalizeReportText(expected);
  const actualText = normalizeReportText(actual);
  const isStructural = (value: string): boolean => /[^\p{L}\p{N}]/u.test(value);
  let expectedIndex = 0;
  let actualIndex = 0;
  const gaps: string[] = [];
  while (expectedIndex < expectedText.length && actualIndex < actualText.length) {
    if (expectedText[expectedIndex] === actualText[actualIndex]) {
      expectedIndex += 1;
      actualIndex += 1;
      continue;
    }
    if (!isStructural(expectedText[expectedIndex]!)) return undefined;
    const start = expectedIndex;
    while (expectedIndex < expectedText.length
      && isStructural(expectedText[expectedIndex]!)
      && expectedText[expectedIndex] !== actualText[actualIndex]) {
      expectedIndex += 1;
    }
    if (start === expectedIndex) return undefined;
    gaps.push(expectedText.slice(start, expectedIndex));
  }
  if (actualIndex < actualText.length) return undefined;
  if (expectedIndex < expectedText.length
    && !expectedText.slice(expectedIndex).split('').every(isStructural)) return undefined;
  const gap = gaps.join('');
  return gap && gap.length <= 20 ? gap : undefined;
}

function appendConcatSuffix(value: unknown, suffix: string): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      if (changed) return item;
      const repaired = appendConcatSuffix(item, suffix);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (!isRecordValue(value)) return { value, changed: false };
  if (value.kind === 'concat' && Array.isArray(value.values)) {
    const last = value.values.at(-1);
    if (isRecordValue(last) && last.kind === 'literal' && last.value === suffix) {
      return { value, changed: false };
    }
    return {
      // Keep the existing separator between the source fields. Appending the
      // suffix as another value inside that concat would insert the separator
      // before the closing punctuation as well (for example `A [B []`).
      value: { kind: 'concat', values: [value, { kind: 'literal', value: suffix }], separator: '' },
      changed: true,
    };
  }
  for (const [key, child] of Object.entries(value)) {
    const repaired = appendConcatSuffix(child, suffix);
    if (!repaired.changed) continue;
    return { value: { ...value, [key]: repaired.value }, changed: true };
  }
  return { value, changed: false };
}

function removeConcatTrailingLiteral(value: unknown, extra: string): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      if (changed) return item;
      const repaired = removeConcatTrailingLiteral(item, extra);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (!isRecordValue(value)) return { value, changed: false };
  if (value.kind === 'concat' && Array.isArray(value.values)) {
    const last = value.values.at(-1);
    if (value.values.length > 1 && isRecordValue(last) && last.kind === 'literal') {
      const separator = typeof value.separator === 'string' ? value.separator : '';
      const literal = String(last.value ?? '');
      const emitted = `${separator}${literal}`;
      if (normalizeReportText(emitted) === normalizeReportText(extra)
        && !/[\p{L}\p{N}]/u.test(emitted)) {
        return { value: { ...value, values: value.values.slice(0, -1) }, changed: true };
      }
    }
    let changed = false;
    const values = value.values.map((item) => {
      if (changed) return item;
      const repaired = removeConcatTrailingLiteral(item, extra);
      changed ||= repaired.changed;
      return repaired.value;
    });
    if (changed) return { value: { ...value, values }, changed: true };
    return { value, changed: false };
  }
  for (const [key, child] of Object.entries(value)) {
    const repaired = removeConcatTrailingLiteral(child, extra);
    if (!repaired.changed) continue;
    return { value: { ...value, [key]: repaired.value }, changed: true };
  }
  return { value, changed: false };
}

function insertConcatGap(value: unknown, gap: string): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      if (changed) return item;
      const repaired = insertConcatGap(item, gap);
      changed ||= repaired.changed;
      return repaired.value;
    });
    return { value: changed ? next : value, changed };
  }
  if (!isRecordValue(value)) return { value, changed: false };
  if (value.kind === 'concat' && Array.isArray(value.values)) {
    const separator = typeof value.separator === 'string' ? value.separator : '';
    if (!separator && value.values.length === 2) {
      return { value: { ...value, separator: gap }, changed: true };
    }
    // A flat concat often appends a closing punctuation literal. Nest the
    // source portion so the inferred separator is not inserted before that
    // literal as well (`name (id)` instead of `name (id ()`).
    const last = value.values.at(-1);
    if (!separator && value.values.length > 2 && isRecordValue(last)
      && last.kind === 'literal' && typeof last.value === 'string'
      && !/[\p{L}\p{N}]/u.test(last.value)) {
      return {
        value: {
          ...value,
          values: [{ kind: 'concat', values: value.values.slice(0, -1), separator: gap }, last],
        },
        changed: true,
      };
    }
  }
  for (const [key, child] of Object.entries(value)) {
    const repaired = insertConcatGap(child, gap);
    if (!repaired.changed) continue;
    return { value: { ...value, [key]: repaired.value }, changed: true };
  }
  return { value, changed: false };
}

type ReplayConcatTarget =
  | { kind: 'scalar'; scalarId: string; mismatches: Array<{ expected: string; actual: string }> }
  | { kind: 'table'; tableId: string; columnId: string; mismatches: Array<{ expected: string; actual: string }> };

function replayConcatTargets(input: ReplayRepairInput, current: ReplayRepairResult): ReplayConcatTarget[] {
  const scalarBindings = new Map(input.layout.scalarBindings.map((binding) => [binding.slotId, binding.value]));
  const scalarTargets = new Map<string, Array<{ expected: string; actual: string }>>();
  const tableTargets = new Map<string, Array<{ expected: string; actual: string }>>();
  const groups = new Map(input.pair.tableGroups.map((group) => [group.id, group]));

  for (const mismatch of current.mismatches) {
    const scalarValue = scalarBindings.get(mismatch.slotId);
    if (scalarValue?.kind === 'scalar') {
      const mismatches = scalarTargets.get(scalarValue.id) ?? [];
      mismatches.push({ expected: mismatch.expected, actual: mismatch.actual });
      scalarTargets.set(scalarValue.id, mismatches);
      continue;
    }
    for (const binding of input.layout.tableBindings) {
      const group = groups.get(binding.groupId);
      if (!group) continue;
      const column = binding.columns.find((candidate) => group.rows.some((row) => (
        row.cells[candidate.columnIndex]?.id === mismatch.slotId
      )));
      if (!column) continue;
      const key = `${binding.tableId}\u0000${column.columnId}`;
      const mismatches = tableTargets.get(key) ?? [];
      mismatches.push({ expected: mismatch.expected, actual: mismatch.actual });
      tableTargets.set(key, mismatches);
      break;
    }
  }

  return [
    ...[...scalarTargets].map(([scalarId, mismatches]) => ({ kind: 'scalar' as const, scalarId, mismatches })),
    ...[...tableTargets].map(([key, mismatches]) => {
      const separator = key.indexOf('\u0000');
      return { kind: 'table' as const, tableId: key.slice(0, separator), columnId: key.slice(separator + 1), mismatches };
    }),
  ];
}

function rewriteConcatTarget(
  plan: ReportPlan,
  target: ReplayConcatTarget,
  token: string,
  rewrite: (value: unknown, token: string) => { value: unknown; changed: boolean },
): ReportPlan {
  if (target.kind === 'scalar') {
    return {
      ...plan,
      scalars: plan.scalars.map((scalar) => scalar.id === target.scalarId
        ? { ...scalar, expression: rewrite(scalar.expression, token).value as ReportScalarExpression }
        : scalar),
    };
  }
  return {
    ...plan,
    tables: plan.tables.map((table) => {
      if (table.kind !== 'aggregate' || table.id !== target.tableId) return table;
      const groupBy = table.groupBy.map((group) => (
        group.id === target.columnId
          ? { ...group, value: rewrite(group.value, token).value as ReportValueExpression }
          : group
      ));
      const columns = table.columns.map((column) => {
        if (column.id !== target.columnId || column.value.kind === 'group_key') return column;
        if (column.value.kind === 'aggregate') {
          return { ...column, value: {
            ...column.value,
            expression: rewrite(column.value.expression, token).value as ReportAggregateExpression,
          } };
        }
        return { ...column, value: {
          ...column.value,
          expression: rewrite(column.value.expression, token).value as ReportDerivedExpression,
        } };
      });
      return { ...table, columns, groupBy };
    }),
  };
}

function identityFieldPath(path: string): boolean {
  const field = path.split('.').at(-1) ?? '';
  return /^(?:id|code|no|number|uuid|.+_(?:id|code|no|number|uuid))$/iu.test(field);
}

function missingConcatFieldShape(
  expected: string,
  actual: string,
  candidateValues: ReadonlySet<string>,
): { prefix: string; suffix: string } | undefined {
  const expectedText = normalizeReportText(expected);
  const actualText = normalizeReportText(actual);
  if (!expectedText.startsWith(actualText) || expectedText === actualText) return undefined;
  const tail = expectedText.slice(actualText.length);
  const matches = [...candidateValues]
    .filter((value) => value && tail.includes(value))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  const value = matches[0];
  if (!value || (matches[1] && matches[1] === value)) return undefined;
  const index = tail.indexOf(value);
  if (index < 0) return undefined;
  const prefix = tail.slice(0, index);
  const suffix = tail.slice(index + value.length);
  if (/[p{L}\p{N}]/u.test(prefix) || /[p{L}\p{N}]/u.test(suffix)) return undefined;
  return { prefix, suffix };
}

function missingConcatFieldCandidates(
  input: ReplayRepairInput,
  table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>,
  base: ReportValueExpression,
): string[] {
  const basePath = base.kind === 'field' ? base.path : '';
  const baseAlias = basePath.split('.')[0] ?? '';
  const baseField = basePath.split('.').at(-1) ?? '';
  const relatedField = baseField.replace(/(?:_name|_label|_title)$/iu, '_id');
  const aliases = tableSourceAliases(input.plan, table);
  const candidates: string[] = [];
  for (const alias of aliases) {
    const snapshot = input.sources[alias];
    if (!snapshot) continue;
    for (const field of new Set(snapshot.rows.flatMap((row) => Object.keys(row)))) {
      const path = `${alias}.${field}`;
      if (path === basePath || !identityFieldPath(path)) continue;
      candidates.push(path);
    }
  }
  return [...new Set(candidates)].sort((left, right) => {
    const score = (path: string): number => {
      const alias = path.split('.')[0] ?? '';
      const field = path.split('.').at(-1) ?? '';
      return Number(alias === baseAlias) * 100 + Number(field === relatedField) * 50
        + Number(field === `${baseField.replace(/_name$/iu, '')}_id`) * 25;
    };
    return score(right) - score(left) || left.localeCompare(right);
  }).slice(0, 24);
}

function missingConcatFieldExpression(
  base: ReportValueExpression,
  path: string,
  prefix: string,
  suffix: string,
): ReportValueExpression {
  const combined: ReportValueExpression = {
    kind: 'concat',
    values: [base, { kind: 'field', path }],
    separator: prefix,
  };
  return suffix
    ? { kind: 'concat', values: [combined, { kind: 'literal', value: suffix }], separator: '' }
    : combined;
}

function rewriteMissingConcatFieldTarget(
  plan: ReportPlan,
  tableId: string,
  columnId: string,
  expression: ReportValueExpression,
): ReportPlan {
  return {
    ...plan,
    tables: plan.tables.map((table) => {
      if (table.kind !== 'aggregate' || table.id !== tableId) return table;
      const groupBy = table.groupBy.map((group) => group.id === columnId ? { ...group, value: expression } : group);
      return groupBy.some((group, index) => group !== table.groupBy[index]) ? { ...table, groupBy } : table;
    }),
  };
}

/**
 * Recover a dynamic identifier that the model dropped from a grouped label,
 * for example `customer_name` rendered as `customer_name (customer_id)`.
 * The suffix must contain a captured identity-field value for every mismatched
 * row and use one consistent punctuation shape; no example value is written
 * into the plan. Replay remains the final oracle for accepting a candidate.
 */
function applyMissingConcatFieldVariants(
  input: ReplayRepairInput,
  current: ReplayRepairResult,
): ReplayRepairInput[] {
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const target of replayConcatTargets(input, current)) {
    if (target.kind !== 'table') continue;
    const table = input.plan.tables.find((candidate): candidate is Extract<ReportPlan['tables'][number], { kind: 'aggregate' }> => (
      candidate.kind === 'aggregate' && candidate.id === target.tableId
    ));
    const group = table?.groupBy.find((candidate) => candidate.id === target.columnId);
    if (!table || !group || group.value.kind === 'concat') continue;
    const base = group.value;
    const paths = missingConcatFieldCandidates(input, table, base);
    for (const path of paths) {
      const snapshot = input.sources[path.split('.')[0]!];
      const field = path.split('.').slice(1).join('.');
      if (!snapshot || !field) continue;
      const values = new Set(snapshot.rows.map((row) => normalizeReportText(String(valueAtPath(row, field) ?? ''))).filter(Boolean));
      let shape: { prefix: string; suffix: string } | undefined;
      for (const mismatch of target.mismatches) {
        const candidateShape = missingConcatFieldShape(mismatch.expected, mismatch.actual, values);
        if (!candidateShape) { shape = undefined; break; }
        if (shape && (shape.prefix !== candidateShape.prefix || shape.suffix !== candidateShape.suffix)) {
          shape = undefined;
          break;
        }
        shape ??= candidateShape;
      }
      if (!shape) continue;
      const expression = missingConcatFieldExpression(base, path, shape.prefix, shape.suffix);
      const plan = rewriteMissingConcatFieldTarget(input.plan, table.id, target.columnId, expression);
      const key = JSON.stringify(plan);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ ...input, plan });
      if (variants.length >= 48) return variants;
    }
  }
  return variants;
}

function applyConcatRepairVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const target of replayConcatTargets(input, current)) {
    const repairs = target.mismatches.flatMap((mismatch) => {
      const suffix = structuralConcatSuffix(mismatch.expected, mismatch.actual);
      const extra = structuralConcatExtra(mismatch.expected, mismatch.actual);
      const gap = structuralConcatGap(mismatch.expected, mismatch.actual);
      return [
        ...(suffix ? [{ token: suffix, rewrite: appendConcatSuffix }] : []),
        ...(extra ? [{ token: extra, rewrite: removeConcatTrailingLiteral }] : []),
        ...(gap ? [{ token: gap, rewrite: insertConcatGap }] : []),
      ];
    });
    for (const repair of repairs) {
      const plan = rewriteConcatTarget(input.plan, target, repair.token, repair.rewrite);
      if (JSON.stringify(plan) === JSON.stringify(input.plan)) continue;
      const key = JSON.stringify(plan);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ ...input, plan });
    }
  }
  return variants;
}

function withAggregateFilter(
  expression: ReportAggregateExpression,
  filter: ReportPredicate | undefined,
): ReportAggregateExpression {
  if (!filter || expression.kind === 'arithmetic') return expression;
  const current = expression.where;
  return {
    ...expression,
    where: current ? { kind: 'and', items: [current, filter] } : filter,
  };
}

function ratioAggregateCandidates(
  table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>,
): Array<{ numerator: ReportAggregateExpression; denominator: ReportAggregateExpression; numeratorId: string; denominatorId: string }> {
  const aggregateColumns = table.columns.flatMap((column) => (
    column.value.kind === 'aggregate'
      ? [{ id: column.id, expression: column.value.expression }]
      : []
  ));
  const numerators = aggregateColumns.filter(({ expression }) => (
    ['sum', 'sum_distinct', 'average'].includes(expression.kind)
  ));
  const denominators = aggregateColumns.filter(({ expression }) => (
    ['sum', 'sum_distinct', 'first', 'average'].includes(expression.kind)
  ));
  const candidates: Array<{ numerator: ReportAggregateExpression; denominator: ReportAggregateExpression; numeratorId: string; denominatorId: string }> = [];
  for (const numerator of numerators) {
    for (const denominator of denominators) {
      if (numerator.id === denominator.id) continue;
      let denominatorExpression = denominator.expression;
      if (denominatorExpression.kind === 'first' && table.groupBy.length > 0) {
        denominatorExpression = {
          kind: 'sum_distinct',
          value: denominatorExpression.value,
          distinctBy: table.groupBy[0]!.value,
          ...(denominatorExpression.where ? { where: denominatorExpression.where } : {}),
        };
      }
      candidates.push({
        numerator: withAggregateFilter(numerator.expression, table.filter),
        denominator: withAggregateFilter(denominatorExpression, table.filter),
        numeratorId: numerator.id,
        denominatorId: denominator.id,
      });
    }
  }
  return candidates;
}

function applyMissingScalarMetricVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const scalarBindings = new Map(input.layout.scalarBindings.map((binding) => [binding.slotId, binding.value]));
  const mismatchedScalars = current.mismatches.flatMap((mismatch) => {
    const value = scalarBindings.get(mismatch.slotId);
    return value?.kind === 'scalar' ? [{ ...mismatch, scalarId: value.id }] : [];
  });
  if (mismatchedScalars.length === 0) return [];

  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const mismatch of mismatchedScalars) {
    const format = formatFromExampleText(mismatch.expected);
    for (const table of input.plan.tables) {
      if (table.kind !== 'aggregate') continue;
      for (const candidate of ratioAggregateCandidates(table)) {
        let id = `${mismatch.scalarId}-from-${table.id}-${candidate.numeratorId}-over-${candidate.denominatorId}`
          .replace(/[^a-zA-Z0-9_-]+/gu, '_');
        const existingIds = new Set(input.plan.scalars.map((scalar) => scalar.id));
        let suffix = 2;
        while (existingIds.has(id)) id = `${mismatch.scalarId}-derived-${suffix++}`;
        const plan: ReportPlan = {
          ...input.plan,
          scalars: [...input.plan.scalars, {
            id,
            expression: { kind: 'arithmetic', operation: 'divide', left: candidate.numerator, right: candidate.denominator },
            ...(format ? { format } : {}),
          }],
        };
        const layout = {
          ...input.layout,
          scalarBindings: input.layout.scalarBindings.map((binding) => (
            binding.slotId === mismatch.slotId
              ? { ...binding, value: { kind: 'scalar' as const, id } }
              : binding
          )),
        };
        const key = JSON.stringify({ plan, layout });
        if (seen.has(key)) continue;
        seen.add(key);
        variants.push({ ...input, plan, layout });
        if (variants.length >= 48) return variants;
      }
    }
  }
  return variants;
}

function datasetDefinition(plan: ReportPlan, id: string | undefined): unknown {
  if (!id) return { baseSource: plan.baseSource, joins: plan.joins, filter: plan.filter };
  const dataset = plan.datasets?.find((candidate) => candidate.id === id);
  if (!dataset) return undefined;
  const { id: _id, ...definition } = dataset;
  return definition;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecordValue(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function sameDatasetDefinition(plan: ReportPlan, left: string | undefined, right: string | undefined): boolean {
  return stableJson(datasetDefinition(plan, left)) === stableJson(datasetDefinition(plan, right));
}

function havingOperatorVariant(value: unknown, from: 'and' | 'or', to: 'and' | 'or'): unknown {
  if (Array.isArray(value)) return value.map((item) => havingOperatorVariant(item, from, to));
  if (!isRecordValue(value)) return value;
  const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, havingOperatorVariant(child, from, to),
  ]));
  return next.kind === from ? { ...next, kind: to } : next;
}

/**
 * A derived status/value case can contain several plausible conditions even
 * when the completed example proves only one of them. Generate bounded
 * candidates by retaining existing predicate clauses (or a smaller subset)
 * so replay can prove the simplification without inventing labels, fields or
 * thresholds. The rewrite walks nested case expressions to cover the same
 * shape inside a coalesce/concat/arithmetic expression.
 */
function derivedCasePredicateVariants(value: unknown): unknown[] {
  const maxVariants = 96;
  const predicateVariants = (predicate: unknown): unknown[] => {
    if (!isRecordValue(predicate)) return [];
    const variants: unknown[] = [];
    const seen = new Set<string>();
    const add = (candidate: unknown): void => {
      const key = JSON.stringify(candidate);
      if (seen.has(key)) return;
      seen.add(key);
      variants.push(candidate);
    };
    if (predicate.kind === 'and' || predicate.kind === 'or') {
      const items = Array.isArray(predicate.items) ? predicate.items : [];
      // A single evidenced clause is the strongest bounded repair for the
      // common two-condition overconstraint (for example threshold AND rate).
      for (const item of items) add(item);
      for (let index = 0; index < items.length; index += 1) {
        const remaining = items.filter((_item, itemIndex) => itemIndex !== index);
        if (remaining.length === 1) add(remaining[0]);
        else if (remaining.length > 1) add({ ...predicate, items: remaining });
      }
      // Preserve the parent operator when only a nested condition needs to be
      // simplified. This keeps the candidate declarative and bounded.
      for (let index = 0; index < items.length; index += 1) {
        for (const nested of predicateVariants(items[index])) {
          add({ ...predicate, items: items.map((item, itemIndex) => itemIndex === index ? nested : item) });
          if (variants.length >= maxVariants) return variants;
        }
      }
    } else if (predicate.kind === 'not') {
      for (const nested of predicateVariants(predicate.item)) add({ ...predicate, item: nested });
    }
    return variants.slice(0, maxVariants);
  };

  const rewrite = (candidate: unknown): unknown[] => {
    if (Array.isArray(candidate)) {
      const variants: unknown[] = [];
      for (let index = 0; index < candidate.length; index += 1) {
        for (const nested of rewrite(candidate[index])) {
          variants.push([...candidate.slice(0, index), nested, ...candidate.slice(index + 1)]);
          if (variants.length >= maxVariants) return variants;
        }
      }
      return variants;
    }
    if (!isRecordValue(candidate)) return [];
    const variants: unknown[] = [];
    const seen = new Set<string>();
    const add = (next: unknown): void => {
      const key = JSON.stringify(next);
      if (seen.has(key)) return;
      seen.add(key);
      variants.push(next);
    };
    if (candidate.kind === 'case' && Array.isArray(candidate.branches)) {
      for (let index = 0; index < candidate.branches.length; index += 1) {
        const branch = candidate.branches[index];
        if (!isRecordValue(branch)) continue;
        for (const when of predicateVariants(branch.when)) {
          add({
            ...candidate,
            branches: candidate.branches.map((item, itemIndex) => itemIndex === index
              ? { ...branch, when }
              : item),
          });
          if (variants.length >= maxVariants) return variants;
        }
      }
    }
    for (const [key, child] of Object.entries(candidate)) {
      for (const nested of rewrite(child)) add({ ...candidate, [key]: nested });
      if (variants.length >= maxVariants) return variants;
    }
    return variants;
  };

  return rewrite(value);
}

function applyDerivedCasePredicateVariants(
  input: ReplayRepairInput,
  current: ReplayRepairResult,
): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  if (targets.tableIds.size === 0) return [];
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate' || !targets.tableIds.has(table.id)) continue;
    const badColumns = targets.tableColumns.get(table.id);
    if (!badColumns) continue;
    for (const column of table.columns) {
      if (!badColumns.has(column.id) || column.value.kind !== 'derived') continue;
      for (const expression of derivedCasePredicateVariants(column.value.expression)) {
        const nextTable: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }> = {
          ...table,
          columns: table.columns.map((candidate) => candidate.id === column.id
            ? { ...candidate, value: { kind: 'derived' as const, expression: expression as ReportDerivedExpression } }
            : candidate),
        };
        const plan = {
          ...input.plan,
          tables: input.plan.tables.map((candidate) => candidate.id === table.id ? nextTable : candidate),
        };
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

function applyTableRepairVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  if (targets.tableIds.size === 0) return [];
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  const addVariant = (plan: ReportPlan): void => {
    const key = JSON.stringify(plan);
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ ...input, plan });
  };
  const groupFieldPaths = (table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): Set<string> => (
    fieldPaths(table.groupBy)
  );
  const sourceShape = (table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): string => {
    const definition = datasetDefinition(input.plan, table.dataset);
    if (!isRecordValue(definition)) return stableJson(definition);
    const { filter: _filter, ...withoutFilter } = definition;
    return stableJson(withoutFilter);
  };
  const datasetFilter = (table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): ReportPredicate | undefined => {
    const definition = datasetDefinition(input.plan, table.dataset);
    return isRecordValue(definition) && isRecordValue(definition.filter)
      ? definition.filter as ReportPredicate
      : undefined;
  };
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate' || !table.limit || !targets.tableIds.has(table.id)) continue;
    const boundSlotIds = new Set(
      input.layout.tableBindings
        .filter((binding) => binding.tableId === table.id)
        .flatMap((binding) => input.pair.tableGroups.find((group) => group.id === binding.groupId)?.rows
          .flatMap((row) => row.cells.map((cell) => cell.id)) ?? []),
    );
    const tableMismatches = current.mismatches.filter((mismatch) => boundSlotIds.has(mismatch.slotId));
    // A delimiter mismatch in a grouped label is a presentation repair, not
    // evidence that the table's filter or top-N rule is wrong. Avoid spending
    // a full sort/filter cross-product on that case; the dedicated concat
    // repair below can fix it in one candidate.
    if (tableMismatches.length > 0
      && tableMismatches.every((mismatch) => (
        structuralConcatSuffix(mismatch.expected, mismatch.actual) !== undefined
        || structuralConcatExtra(mismatch.expected, mismatch.actual) !== undefined
        || structuralConcatGap(mismatch.expected, mismatch.actual) !== undefined
      ))) continue;
    const siblings = input.plan.tables.filter((candidate): candidate is Extract<typeof candidate, { kind: 'aggregate' }> => (
      candidate.kind === 'aggregate' && candidate.id !== table.id
        && sameDatasetDefinition(input.plan, candidate.dataset, table.dataset)
        && (stableJson(candidate.groupBy) === stableJson(table.groupBy)
          || [...groupFieldPaths(candidate)].some((path) => groupFieldPaths(table).has(path)))
    ));
    const filterOptions: Array<typeof table.filter> = [table.filter];
    const addFilterOption = (filter: ReportPredicate | undefined): void => {
      if (filter && !filterOptions.some((candidate) => stableJson(candidate) === stableJson(filter))) {
        filterOptions.push(filter);
      }
    };
    addFilterOption(datasetFilter(table));
    for (const candidate of input.plan.tables) {
      if (candidate.kind !== 'aggregate' || candidate.id === table.id
        || sourceShape(candidate) !== sourceShape(table)) continue;
      // A dataset-level period/status predicate is independent of the output
      // grouping. Collect it before checking grouping overlap so a regional
      // or tier summary can evidence the same row subset for a customer or
      // risk table. Row-level table filters still need an overlapping shape;
      // otherwise a predicate may describe a different business slice.
      addFilterOption(datasetFilter(candidate));
      const overlapsGrouping = stableJson(candidate.groupBy) === stableJson(table.groupBy)
        || [...groupFieldPaths(candidate)].some((path) => groupFieldPaths(table).has(path));
      if (!overlapsGrouping) continue;
      addFilterOption(candidate.filter);
    }
    // Prefer a more specific, already evidenced predicate when the model
    // omitted a dataset filter. This keeps the bounded candidate budget from
    // exhausting itself on the unfiltered/date-only variants before a shared
    // status or eligibility subset is evaluated.
    const filterOrder = new Map(filterOptions.map((filter, index) => [stableJson(filter), index]));
    filterOptions.sort((left, right) => {
      return predicateSpecificity(right) - predicateSpecificity(left)
        || (filterOrder.get(stableJson(left)) ?? 0) - (filterOrder.get(stableJson(right)) ?? 0);
    });
    const extraColumns = siblings.flatMap((sibling) => sibling.columns.filter((column) => (
      column.value.kind !== 'group_key' && !table.columns.some((existing) => existing.id === column.id)
    )));
    const numericColumns = (columns: typeof table.columns): typeof table.columns => columns.filter((column) => column.value.kind !== 'group_key');
    const groupColumns = (columns: typeof table.columns): typeof table.columns => columns.filter((column) => column.value.kind === 'group_key');
    const orderedSortColumns = [...numericColumns(extraColumns), ...numericColumns(table.columns), ...groupColumns(table.columns), ...groupColumns(extraColumns)];
    const candidateColumnIds = [...new Set(orderedSortColumns.map((column) => column.id))];
    const columns = extraColumns.reduce((currentColumns, column) => (
      currentColumns.some((existing) => existing.id === column.id) ? currentColumns : [...currentColumns, column]
    ), [...table.columns]);
    const havingOptions: Array<typeof table.having> = [table.having];
    if (table.having?.kind === 'and' || table.having?.kind === 'or') {
      // A model often preserves every plausible criterion in having even when
      // the example table applies only one of them. Try each observed clause
      // as an independent candidate; replay decides whether it is evidenced.
      havingOptions.push(...table.having.items);
      const opposite = table.having.kind === 'and' ? 'or' : 'and';
      havingOptions.push(havingOperatorVariant(table.having, table.having.kind, opposite) as typeof table.having);
    }
    const sortOptions: NonNullable<typeof table.sort> = [];
    const addSortOption = (sort: NonNullable<typeof table.sort>[number] | undefined): void => {
      if (!sort || !candidateColumnIds.includes(sort.columnId)
        || sortOptions.some((candidate) => candidate.columnId === sort.columnId && candidate.direction === sort.direction)) return;
      sortOptions.push(sort);
    };
    // A sibling's explicit ordering is stronger evidence than a newly guessed
    // metric, especially for a table that hides the metric used for top-N.
    for (const sibling of siblings) for (const sort of sibling.sort ?? []) addSortOption(sort);
    for (const sort of table.sort ?? []) addSortOption(sort);
    for (const columnId of candidateColumnIds) {
      addSortOption({ columnId, direction: 'asc' });
      addSortOption({ columnId, direction: 'desc' });
    }
    for (const filter of filterOptions) {
      for (const having of havingOptions) {
        for (const sort of sortOptions) {
          const nextTable = {
            ...table, columns, sort: [sort],
            ...(filter ? { filter } : { filter: undefined }),
            ...(having ? { having } : { having: undefined }),
          };
          addVariant({ ...input.plan, tables: input.plan.tables.map((candidate) => candidate.id === table.id ? nextTable : candidate) });
          if (variants.length >= 192) return variants;
        }
      }
    }
  }
  return variants;
}

function tableSourceAliases(plan: ReportPlan, table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): string[] {
  const dataset = table.dataset ? plan.datasets?.find((candidate) => candidate.id === table.dataset) : undefined;
  const baseSource = dataset?.baseSource ?? plan.baseSource;
  const joins = dataset?.joins ?? plan.joins;
  return [...new Set([baseSource, ...joins.map((join) => join.source)])];
}

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

function aggregateColumnReferences(value: unknown): Set<string> {
  const references = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!isRecordValue(candidate)) return;
    if (candidate.kind === 'column' && typeof candidate.columnId === 'string') {
      references.add(candidate.columnId);
    }
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return references;
}

/**
 * A derived table ratio can hide the aggregate columns that determine it, so
 * those source filters do not appear in the direct mismatch. Reuse an
 * already-evidenced aggregate predicate across the referenced hidden columns
 * and let exact replay decide whether the ratio's row subset is correct.
 */
function applyAggregateFilterVariants(
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

function applyDerivedTableRatioVariants(
  input: ReplayRepairInput,
  current: ReplayRepairResult,
): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  const filters = replayPredicateCandidates(input.plan);
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate' || !targets.tableIds.has(table.id)) continue;
    const badColumns = targets.tableColumns.get(table.id);
    if (!badColumns) continue;
    for (const column of table.columns) {
      if (!badColumns.has(column.id) || column.value.kind !== 'derived') continue;
      const expression = column.value.expression;
      if (!isRecordValue(expression) || expression.kind !== 'arithmetic' || expression.operation !== 'divide'
        || !isRecordValue(expression.left) || expression.left.kind !== 'column'
        || !isRecordValue(expression.right) || expression.right.kind !== 'column') continue;
      const numeratorId = typeof expression.left.columnId === 'string' ? expression.left.columnId : undefined;
      const denominatorId = typeof expression.right.columnId === 'string' ? expression.right.columnId : undefined;
      const numerator = table.columns.find((candidate) => candidate.id === numeratorId);
      const denominator = table.columns.find((candidate) => candidate.id === denominatorId);
      if (!numerator || numerator.value.kind !== 'aggregate' || !denominator || denominator.value.kind !== 'aggregate') continue;
      for (const candidate of ratioDenominatorCandidates(input.sources, {
        numerator: numerator.value.expression,
        denominator: denominator.value.expression,
      })) {
        for (const filter of filters) {
          const nextTable = {
            ...table,
            columns: table.columns.map((candidateColumn) => {
              if (candidateColumn.id === numerator.id && candidateColumn.value.kind === 'aggregate') {
                return { ...candidateColumn, value: { ...candidateColumn.value,
                  expression: filter ? withAggregateFilter(candidateColumn.value.expression, filter) : candidateColumn.value.expression } };
              }
              if (candidateColumn.id === denominator.id && candidateColumn.value.kind === 'aggregate') {
                return { ...candidateColumn, value: { ...candidateColumn.value,
                  expression: filter ? withAggregateFilter(candidate, filter) : candidate } };
              }
              return candidateColumn;
            }),
          };
          const plan = { ...input.plan, tables: input.plan.tables.map((candidateTable) => candidateTable.id === table.id ? nextTable : candidateTable) };
          const key = JSON.stringify(plan);
          if (seen.has(key)) continue;
          seen.add(key);
          variants.push({ ...input, plan });
          if (variants.length >= 96) return variants;
        }
      }
    }
  }
  return variants;
}

function applyAggregateRepairVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
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

/**
 * Use the completed PDF as a bounded oracle for generic, declarative repairs
 * after model revisions. Candidates are built from captured numeric fields,
 * sibling table columns and existing predicates; no example value, id or row
 * is inserted into the reusable plan. A candidate is kept only when it
 * strictly reduces the actual replay mismatch count.
 */
export function repairExampleReplayInference(input: ReplayRepairInput): ReplayRepairResult {
  const ordered = repairDerivedColumnOrder(input.plan, input.layout);
  let currentInput = { ...input, plan: ordered.plan, layout: ordered.layout };
  const initial = replayRepairResult(currentInput, true);
  let current = initial ?? { ...currentInput, mismatches: [], executionError: 'report_replay_unavailable' };
  let currentScore = initial ? initial.mismatches.length : Number.POSITIVE_INFINITY;
  // Keep the search bounded and greedy. Evaluating every cross-product of
  // filters, formulas and sort keys is quadratic in the number of captured
  // fields and made a large report spend its entire deadline in replay. Each
  // generator is ordered from strongest evidence to fallback guesses; accept
  // the first strict improvement, then restart with the new diagnostics so a
  // later repair sees the corrected table shape.
  const generators = [
    applyDerivedCasePredicateVariants,
    applyAggregateFilterVariants,
    applyDerivedTableRatioVariants,
    applyTableRepairVariants,
    applyAggregateRepairVariants,
    applyRatioRepairVariants,
    applyMissingConcatFieldVariants,
    applyConcatRepairVariants,
    applyMissingScalarMetricVariants,
  ];
  for (let pass = 0; pass < 8 && currentScore > 0; pass += 1) {
    let improved = false;
    for (const generate of generators) {
      const variants = generate(currentInput, current);
      let accepted: { input: ReplayRepairInput; result: ReplayRepairResult } | undefined;
      for (const variant of variants) {
        const evaluated = replayRepairResult(variant);
        if (!evaluated || evaluated.mismatches.length >= currentScore) continue;
        accepted = { input: variant, result: evaluated };
        break;
      }
      if (!accepted) continue;
      currentInput = accepted.input;
      current = accepted.result;
      currentScore = current.mismatches.length;
      improved = true;
      break;
    }
    if (!improved) break;
  }
  return current;
}
