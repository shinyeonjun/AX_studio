import type { ExceptionReviewTaskPlan } from './contracts.js';

/**
 * Deterministic counts for the `exception_counts_v1` summary. Host code owns this step: every
 * source row must have exactly one decision. Rows that are not reviewed yet are reported
 * separately and make the whole summary a draft, so an unconfirmed count is never presented
 * as final.
 */
export type ExceptionRowDecision =
  | { rowId: string; status: 'reviewed'; categoryId: string }
  | { rowId: string; status: 'unreviewed' };

export type ExceptionCountsRefusal =
  | 'decision_missing' | 'decision_unknown_row' | 'decision_duplicate' | 'decision_unknown_category';

export class ExceptionCountsError extends Error {
  constructor(readonly code: ExceptionCountsRefusal, message: string) {
    super(message);
    this.name = 'ExceptionCountsError';
  }
}

export interface ExceptionCountsSummary {
  templateId: 'exception_counts_v1';
  sourceRowCount: number;
  reviewedCount: number;
  unreviewedCount: number;
  /** True while any row is unreviewed; the report must be labelled as a draft. */
  draft: boolean;
  /** Every plan category appears, in plan order, including zero counts. */
  categories: Array<{ id: string; label: string; count: number }>;
}

type CountsInput = Pick<ExceptionReviewTaskPlan, 'categories'> & {
  dataset: Pick<ExceptionReviewTaskPlan['dataset'], 'rows' | 'sourceRowCount'>;
};

export function aggregateExceptionCounts(
  plan: CountsInput,
  decisions: readonly ExceptionRowDecision[],
): ExceptionCountsSummary {
  const rowIds = new Set(plan.dataset.rows.map(row => row.id));
  const categoryIds = new Map(plan.categories.map(category => [category.id, category.label]));
  const decided = new Map<string, ExceptionRowDecision>();

  for (const decision of decisions) {
    if (!rowIds.has(decision.rowId)) {
      throw new ExceptionCountsError('decision_unknown_row', `Decision refers to a row outside the reviewed dataset: ${decision.rowId}`);
    }
    if (decided.has(decision.rowId)) {
      throw new ExceptionCountsError('decision_duplicate', `A row has more than one decision: ${decision.rowId}`);
    }
    if (decision.status === 'reviewed' && !categoryIds.has(decision.categoryId)) {
      throw new ExceptionCountsError('decision_unknown_category', `Category is not in the reviewed recipe: ${decision.categoryId}`);
    }
    decided.set(decision.rowId, decision);
  }

  for (const row of plan.dataset.rows) {
    if (!decided.has(row.id)) {
      throw new ExceptionCountsError('decision_missing', `No decision for a row in the dataset: ${row.id}`);
    }
  }

  const counts = new Map(plan.categories.map(category => [category.id, 0]));
  let reviewedCount = 0;
  let unreviewedCount = 0;
  for (const decision of decided.values()) {
    if (decision.status === 'reviewed') {
      counts.set(decision.categoryId, (counts.get(decision.categoryId) ?? 0) + 1);
      reviewedCount += 1;
    } else {
      unreviewedCount += 1;
    }
  }

  // Each row is counted exactly once, so the parts must add up to the source row count.
  if (reviewedCount + unreviewedCount !== plan.dataset.sourceRowCount) {
    throw new ExceptionCountsError('decision_missing', 'Counts do not cover every source row.');
  }

  return {
    templateId: 'exception_counts_v1',
    sourceRowCount: plan.dataset.sourceRowCount,
    reviewedCount,
    unreviewedCount,
    draft: unreviewedCount > 0,
    categories: plan.categories.map(category => ({
      id: category.id,
      label: category.label,
      count: counts.get(category.id) ?? 0,
    })),
  };
}
