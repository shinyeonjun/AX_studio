import { describe, expect, it } from 'vitest';
import { aggregateExceptionCounts, ExceptionCountsError, type ExceptionRowDecision } from './aggregate.js';

const plan = {
  categories: [
    { id: 'within', label: 'Within policy', description: 'ok' },
    { id: 'exception', label: 'Exception', description: 'needs review' },
    { id: 'unused', label: 'Unused', description: 'no rows' },
  ],
  dataset: {
    sourceRowCount: 3,
    rows: [{ id: 'row_a', sourceRow: 2 }, { id: 'row_b', sourceRow: 3 }, { id: 'row_c', sourceRow: 4 }],
  },
};

const reviewed = (rowId: string, categoryId: string): ExceptionRowDecision => ({ rowId, status: 'reviewed', categoryId });

describe('aggregateExceptionCounts', () => {
  it('counts reviewed rows per category, keeping zero counts and plan order', () => {
    const summary = aggregateExceptionCounts(plan, [
      reviewed('row_a', 'within'), reviewed('row_b', 'exception'), reviewed('row_c', 'within'),
    ]);
    expect(summary).toEqual({
      templateId: 'exception_counts_v1',
      sourceRowCount: 3,
      reviewedCount: 3,
      unreviewedCount: 0,
      draft: false,
      categories: [
        { id: 'within', label: 'Within policy', count: 2 },
        { id: 'exception', label: 'Exception', count: 1 },
        { id: 'unused', label: 'Unused', count: 0 },
      ],
    });
  });

  it('keeps unreviewed rows out of the category counts and marks the summary as a draft', () => {
    const summary = aggregateExceptionCounts(plan, [
      reviewed('row_a', 'within'), { rowId: 'row_b', status: 'unreviewed' }, reviewed('row_c', 'exception'),
    ]);
    expect(summary.reviewedCount).toBe(2);
    expect(summary.unreviewedCount).toBe(1);
    expect(summary.draft).toBe(true);
    expect(summary.categories.map(category => category.count)).toEqual([1, 1, 0]);
  });

  it.each([
    ['a row has no decision', [reviewed('row_a', 'within'), reviewed('row_b', 'within')], 'decision_missing'],
    ['a decision names a row outside the dataset', [reviewed('row_a', 'within'), reviewed('row_b', 'within'), reviewed('row_c', 'within'), reviewed('row_x', 'within')], 'decision_unknown_row'],
    ['a row is decided twice', [reviewed('row_a', 'within'), reviewed('row_a', 'exception'), reviewed('row_b', 'within'), reviewed('row_c', 'within')], 'decision_duplicate'],
    ['a category is not in the recipe', [reviewed('row_a', 'made_up'), reviewed('row_b', 'within'), reviewed('row_c', 'within')], 'decision_unknown_category'],
  ] as const)('refuses when %s', (_name, decisions, code) => {
    expect(() => aggregateExceptionCounts(plan, decisions)).toThrow(ExceptionCountsError);
    expect(() => aggregateExceptionCounts(plan, decisions)).toThrow(expect.objectContaining({ code }));
  });
});
