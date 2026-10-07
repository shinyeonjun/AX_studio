import type { ReportDerivedExpression, ReportPlan, ReportPredicate } from '../../plan/schema.js';
import { isRecordValue } from '../../plan/value.js';
import {
  type ReplayRepairInput,
  type ReplayRepairResult,
  mismatchedReplayTargets,
  stableJson,
} from './shared.js';

export function aggregateFilterCandidates(plan: ReportPlan): ReportPredicate[] {
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

export function predicateSpecificity(filter: ReportPredicate | undefined): number {
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
export function replayPredicateCandidates(plan: ReportPlan): Array<ReportPredicate | undefined> {
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

export function applyDerivedCasePredicateVariants(
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
