import { describe, expect, it } from 'vitest';
import { describeReplayScale } from './replay-revision.js';

describe('a replayed number that is a whole multiple of the example', () => {
  it('names the factor and the columns with that many distinct values', () => {
    const rows = Array.from({ length: 62 }, (_, index) => ({ day: `2026-08-${String(index % 31 + 1).padStart(2, '0')}`, amount: 100 }));
    const hints = describeReplayScale([
      { slotId: 'avg', expected: '200원', actual: '6,200원' },
      { slotId: 'other', expected: '7원', actual: '10원' },
    ], { orders: { id: 'orders', complete: true, rows } });
    expect(hints).toEqual([{ slotId: 'avg', actualOverExpected: '31.000', columnsWithThatManyDistinctValues: ['orders.day'] }]);
  });
});
