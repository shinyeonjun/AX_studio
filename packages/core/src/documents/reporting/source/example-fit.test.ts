import { describe, expect, it } from 'vitest';
import { exampleFit } from './example-fit.js';

const orders = [
  { day: '2026-08-01', category: '식품', status: '결제', amount: 12_000 },
  { day: '2026-08-01', category: '문구', status: '취소', amount: 3_000 },
  { day: '2026-08-02', category: '식품', status: '결제', amount: 20_000 },
  { day: '2026-08-03', category: '문구', status: '결제', amount: 15_000 },
];
const stock = [
  { day: '2026-08-01', item: '복사용지', kind: '입고', quantity: 40, amount: 168_000 },
  { day: '2026-08-02', item: '볼펜', kind: '출고', quantity: 12, amount: 5_400 },
];

describe('how much of a completed report a candidate file explains', () => {
  it('tells the right source by the example numbers it reproduces, without sending a value', () => {
    // Total without cancelled orders, food sales, and the stationery sale left after cancelling.
    const example = [47_000, 32_000, 15_000];
    const right = exampleFit(orders, ['day', 'category', 'status', 'amount'], example);
    const wrong = exampleFit(stock, ['day', 'item', 'kind', 'quantity', 'amount'], example);
    expect(right).toEqual({ exampleNumbersExplained: 3, exampleNumbersTested: 3 });
    expect(wrong).toEqual({ exampleNumbersExplained: 0, exampleNumbersTested: 3 });
  });
});
