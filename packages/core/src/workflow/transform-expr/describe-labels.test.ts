import { describe, expect, it } from 'vitest';
import { describeShaping } from './describe.js';
import type { TransformExpr } from './dsl.js';

describe('a job card describes table shaping with Korean headers', () => {
  it('names every column by its header when one is known', () => {
    const expr = {
      op: 'sort', by: [{ column: 'stock', direction: 'asc' }],
      input: { op: 'filter', where: { op: 'lt', left: { ref: 'stock' }, right: { lit: 10 } }, input: { op: 'source', sourceId: 's' } },
    } as TransformExpr;
    const headers: Record<string, string> = { stock: '재고' };
    expect(describeShaping(expr, (column) => headers[column] ?? column)).toBe('조건: 재고 < 10 · 정렬: 재고 오름차순');
    expect(describeShaping(expr)).toBe('조건: stock < 10 · 정렬: stock 오름차순');
  });
});
