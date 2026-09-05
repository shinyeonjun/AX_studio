import type { PdfReportPairAnalysis } from '../../document-engine/types/pdf.js';
import type { ReportLayoutPlan } from '../layout/schema.js';
import type { ReportPeriod } from '../source/schema.js';
import type {
  ReportAggregateExpression,
  ReportOutputPredicate,
  ReportOutputValueExpression,
  ReportPlan,
  ReportValueExpression,
} from './schema.js';

function valueDependsOnRuntime(expression: ReportValueExpression): boolean {
  switch (expression.kind) {
    case 'field':
      return true;
    case 'literal':
      return false;
    case 'arithmetic':
      return valueDependsOnRuntime(expression.left) || valueDependsOnRuntime(expression.right);
    case 'coalesce':
    case 'concat':
      return expression.values.some(valueDependsOnRuntime);
  }
}

function aggregateDependsOnRuntime(expression: ReportAggregateExpression): boolean {
  switch (expression.kind) {
    case 'count':
      return true;
    case 'count_distinct':
    case 'sum':
    case 'average':
    case 'min':
    case 'max':
    case 'first':
      return valueDependsOnRuntime(expression.value);
    case 'sum_distinct':
      return valueDependsOnRuntime(expression.value) && valueDependsOnRuntime(expression.distinctBy);
    case 'arithmetic':
      return aggregateDependsOnRuntime(expression.left) || aggregateDependsOnRuntime(expression.right);
  }
}

function outputPredicateDependsOnRuntime(predicate: ReportOutputPredicate): boolean {
  switch (predicate.kind) {
    case 'compare':
      return outputValueDependsOnRuntime(predicate.left) || outputValueDependsOnRuntime(predicate.right);
    case 'in':
      return outputValueDependsOnRuntime(predicate.value)
        || predicate.values.some(outputValueDependsOnRuntime);
    case 'and':
    case 'or':
      return predicate.items.some(outputPredicateDependsOnRuntime);
    case 'not':
      return outputPredicateDependsOnRuntime(predicate.item);
    case 'is_null':
      return outputValueDependsOnRuntime(predicate.value);
  }
}

function outputValueDependsOnRuntime(expression: ReportOutputValueExpression): boolean {
  switch (expression.kind) {
    case 'column':
      return true;
    case 'literal':
      return false;
    case 'arithmetic':
      return outputValueDependsOnRuntime(expression.left) || outputValueDependsOnRuntime(expression.right);
    case 'coalesce':
    case 'concat':
      return expression.values.some(outputValueDependsOnRuntime);
    case 'case':
      return expression.branches.some((branch) => (
        outputPredicateDependsOnRuntime(branch.when) || outputValueDependsOnRuntime(branch.value)
      )) || outputValueDependsOnRuntime(expression.fallback);
  }
}

function periodDescriptors(period: ReportPeriod): string[] {
  const [year, paddedMonth] = period.start.split('-');
  const month = String(Number(paddedMonth));
  return [
    period.label,
    `${year}-${paddedMonth}`,
    `${year}년 ${month}월`,
    `${year}년 ${paddedMonth}월`,
  ].filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
}

function isPeriodLiteral(value: string, periods: ReportPeriod[]): boolean {
  const trimmed = value.trim();
  const isoDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/)?.[1];
  if (isoDate && periods.some((period) => isoDate >= period.start && isoDate <= period.endInclusive)) {
    return true;
  }
  return periods
    .flatMap(periodDescriptors)
    .some((descriptor) => trimmed.includes(descriptor));
}

function assertNoPeriodString(value: string, periods: ReportPeriod[]): void {
  if (!isPeriodLiteral(value, periods)) return;
  const descriptor = periods.flatMap(periodDescriptors).find((candidate) => value.includes(candidate));
  throw new Error(`report_plan_period_literal_forbidden:${descriptor ?? value}`);
}

function assertNoPeriodLiterals(value: unknown, periods: ReportPeriod[]): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoPeriodLiterals(item, periods);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (record.kind === 'literal' && typeof record.value === 'string' && isPeriodLiteral(record.value, periods)) {
    throw new Error(`report_plan_period_literal_forbidden:${record.value}`);
  }
  for (const child of Object.values(record)) assertNoPeriodLiterals(child, periods);
}

/**
 * Enforces properties that structured parsing alone cannot express: generated
 * values must remain dependent on runtime data or host period metadata, and
 * example/target period values cannot be copied into reusable predicates.
 */
export function assertReusableReportPlan(
  plan: ReportPlan,
  periods: { examplePeriod: ReportPeriod; targetPeriod: ReportPeriod },
): void {
  for (const scalar of plan.scalars) {
    if (!aggregateDependsOnRuntime(scalar.expression)) {
      throw new Error(`report_plan_output_not_source_derived:scalar.${scalar.id}`);
    }
  }
  for (const table of plan.tables) {
    if (table.kind !== 'aggregate') continue;
    for (const key of table.groupBy) {
      if (!valueDependsOnRuntime(key.value)) {
        throw new Error(`report_plan_output_not_source_derived:table.${table.id}.group.${key.id}`);
      }
    }
    for (const column of table.columns) {
      if (column.value.kind === 'aggregate' && !aggregateDependsOnRuntime(column.value.expression)) {
        throw new Error(`report_plan_output_not_source_derived:table.${table.id}.column.${column.id}`);
      }
      if (column.value.kind === 'derived' && !outputValueDependsOnRuntime(column.value.expression)) {
        throw new Error(`report_plan_output_not_source_derived:table.${table.id}.column.${column.id}`);
      }
    }
  }
  for (const text of plan.texts) {
    if (text.kind === 'computed') {
      if (!/\{\{\s*(?:scalar|table|meta)\./.test(text.template)) {
        throw new Error(`report_plan_output_not_source_derived:text.${text.id}`);
      }
      assertNoPeriodString(text.template, [periods.examplePeriod, periods.targetPeriod]);
      continue;
    }
    const staticValue = text.kind === 'invariant' ? text.value : text.exampleValue;
    if (/\d/u.test(staticValue)) {
      throw new Error(`report_plan_static_text_data_forbidden:text.${text.id}`);
    }
    assertNoPeriodString(staticValue, [periods.examplePeriod, periods.targetPeriod]);
  }
  assertNoPeriodLiterals(plan, [periods.examplePeriod, periods.targetPeriod]);
}

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Static prose is permitted only when it is explicitly marked and copied
 * from an actually bound example slot. It is never used for numeric/date data.
 */
export function assertReusableReportPresentation(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  periods: { examplePeriod: ReportPeriod; targetPeriod: ReportPeriod },
): void {
  const periodList = [periods.examplePeriod, periods.targetPeriod];
  assertNoPeriodString(layout.outputFileName, periodList);
  for (const token of layout.outputFileName.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (!token[1]?.trim().startsWith('meta.')) throw new Error('report_output_filename_token_invalid');
  }

  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  for (const text of plan.texts) {
    if (text.kind === 'computed') continue;
    const expected = text.kind === 'invariant' ? text.value : text.exampleValue;
    const bindings = layout.scalarBindings.filter((binding) => (
      binding.value.kind === 'text' && binding.value.id === text.id
    ));
    if (bindings.length === 0) throw new Error(`report_plan_static_text_unbound:${text.id}`);
    for (const binding of bindings) {
      const slot = slots.get(binding.slotId);
      if (!slot || normalized(slot.exampleText) !== normalized(expected)) {
        throw new Error(`report_plan_static_text_not_from_example:${text.id}`);
      }
    }
  }
}
