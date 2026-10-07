import { z } from 'zod';

export type StructuralIssue = { code: string; path: (string | number)[] };

export function structuralIssues(error: unknown): StructuralIssue[] {
  const candidate: unknown[] = error instanceof z.ZodError ? error.issues
    : error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)
      ? error.issues as unknown[] : [];
  return candidate.flatMap((issue): StructuralIssue[] => {
    if (!issue || typeof issue !== 'object') return [];
    const record = issue as Record<string, unknown>;
    if (typeof record.code !== 'string' || !Array.isArray(record.path)) return [];
    const path = record.path.filter((part: unknown): part is string | number => (
      typeof part === 'string' || (typeof part === 'number' && Number.isInteger(part))
    )).slice(0, 32);
    return [{ code: record.code.slice(0, 80), path }];
  }).slice(0, 12);
}

export function isInvalidModelOutput(error: unknown): boolean {
  return error instanceof z.ZodError || Boolean(error && typeof error === 'object'
    && 'code' in error && error.code === 'model_output_invalid');
}

export function planValidationIssues(error: unknown): StructuralIssue[] {
  const raw = error instanceof Error ? error.message : '';
  const match = /^(report_plan_[a-z0-9_]+)(?::(.+))?$/i.exec(raw);
  if (!match) return [];
  const suffix = match[2];
  const path = suffix && /^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)*$/i.test(suffix)
    ? suffix.split('.').slice(0, 8) : [];
  return [{ code: match[1]!.slice(0, 80), path }];
}

export function structuralCorrectionGuidance(issues: StructuralIssue[]): string {
  if (issues.some((issue) => issue.code === 'report_plan_source_not_captured')) {
    return '\nPlan correction: use only source aliases declared by capturePlan.http or capturePlan.rdb. Remove invented aliases and keep every field path, join source, dataset baseSource and dataset join source within that captured alias set.';
  }
  if (issues.some((issue) => issue.code === 'report_plan_output_not_source_derived')) {
    return '\nPlan correction: every generated scalar, group key, aggregate column and derived column must depend on a captured source field, a runtime aggregate, or allowed period metadata. A literal table cell such as a fixed status/classification is not reusable; derive it with a case predicate over runtime columns (or omit it when the example does not prove a rule). Do not encode example numbers, dates, identifiers or labels as output values.';
  }
  if (issues.some((issue) => issue.code === 'report_plan_period_literal_forbidden')) {
    return '\nPlan correction: remove copied example/target dates and period labels from literals, filters, expressions and text. Use meta.periodStart, meta.periodEndExclusive, meta.periodEndInclusive or another allowed metadata token so the same plan works for a future period.';
  }
  if (issues.some((issue) => issue.code === 'report_plan_static_text_data_forbidden')) {
    return '\nPlan correction: static text may contain only nonnumeric prose proven unchanged by a bound example slot. Make dates, identifiers, amounts, percentages and source names computed from fields or metadata.';
  }
  if (issues.some((issue) => issue.code === 'report_plan_static_text_not_from_example')) {
    return '\nPlan correction: remove or rewrite the static text so it exactly matches the example slot it is bound to. Do not invent new prose; use a computed template when the text contains runtime data.';
  }
  const missingJoin = issues.find((issue) => issue.code === 'report_plan_field_source_not_joined');
  if (missingJoin) {
    const source = missingJoin.path.at(-1);
    return `\nPlan correction: a field references the captured source${source ? ` ${source}` : ''} without a join in that dataset. Add an explicit left or inner join with evidenced keys, or move the calculation to a dataset whose base source owns the field; never rely on an unjoined or nested alias.`;
  }
  if (issues.some((issue) => issue.code === 'report_plan_table_coverage_incomplete')) {
    return '\nPlan correction: every detected PDF table group needs its own compatible result table before layout. Declare one distinct table for each group, with at least the group column count; never reuse a smaller table or drop groups to make validation pass.';
  }
  if (issues.some((issue) => issue.code === 'report_plan_execution_invalid')) {
    if (issues.some((issue) => issue.path.includes('report_text_reference_missing'))) {
      return '\nPlan correction: a computed text references metadata that the selected source type does not provide. Use only meta.source.<http-alias>.path for HTTP sources and meta.source.<rdb-alias>.table/meta.source.<rdb-alias>.tableName for DB sources; remove unavailable metadata references and keep the text reusable.';
    }
    if (issues.some((issue) => issue.path.includes('report_text_reference_invalid'))) {
      return '\nPlan correction: a computed text uses an invalid token. Use exactly {{scalar.<scalarId>}}, {{meta.<metadataKey}} or {{table.<tableId>.rowCount}}; do not use colon-prefixed tokens or invent a token namespace.';
    }
    return '\nPlan correction: the host could not execute the previous calculation against every captured example row. Re-check field aliases, joins, null and numeric handling, and dataset selection; return a plan that executes without inventing fallback values.';
  }
  if (issues.some((issue) => issue.code === 'invalid_union'
    && issue.path.includes('tables') && issue.path.includes('filter'))) {
    return '\nSchema correction: an aggregate table filter accepts only row-level field predicates. Do not put sum, first, arithmetic, column or scalar expressions in table.filter; put group-level thresholds in a derived case column or omit the filter.';
  }
  return '';
}
