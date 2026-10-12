import { describe, expect, it } from 'vitest';
import type { TableArtifact } from '../../../../contracts/artifacts/table.js';
import type { TransformExpr } from '../../../../workflow/transform-expr/dsl.js';
import { statusBreakdownNote } from './status-breakdown.js';

const orders: TableArtifact = {
  id: 'orders', kind: 'table', truncated: false,
  columns: [
    { name: 'amount', label: '금액', type: 'number', nullable: true, inferred: false },
    { name: 'status', label: '상태', type: 'string', nullable: true, inferred: false },
  ],
  rows: [
    { index: 0, values: { amount: 1000, status: '결제완료' } },
    { index: 1, values: { amount: 2000, status: '결제완료' } },
    { index: 2, values: { amount: 500, status: '취소' } },
  ],
};
const source: TransformExpr = { op: 'source', sourceId: 'orders' };
const sum: TransformExpr = { op: 'totals', input: source, aggregates: [{ as: '금액 합계', fn: 'sum', column: 'amount' }] };

describe('statusBreakdownNote', () => {
  it('shows each status next to a total over every row', () => {
    expect(statusBreakdownNote(orders, sum))
      .toBe('이 값은 상태와 관계없이 모든 행(3건)을 포함합니다. 상태별: 결제완료 2건 3,000 · 취소 1건 500');
    expect(statusBreakdownNote(orders, { op: 'aggregate', input: source, fn: 'count' }))
      .toBe('이 값은 상태와 관계없이 모든 행(3건)을 포함합니다. 상태별: 결제완료 2건 · 취소 1건');
  });

  it('stays quiet when the person already chose the rows or the total is something else', () => {
    const filtered: TransformExpr = { ...sum, input: { op: 'filter', input: source, where: { column: 'status', op: 'neq', value: '취소' } } as never };
    expect(statusBreakdownNote(orders, filtered)).toBeUndefined();
    expect(statusBreakdownNote(orders, { op: 'group', input: source, by: 'status', aggregates: [{ as: 'n', fn: 'count' }] })).toBeUndefined();
    expect(statusBreakdownNote(orders, { op: 'aggregate', input: source, fn: 'avg', column: 'amount' })).toBeUndefined();
  });

  it('stays quiet without a status column, with one status, or with a partial table', () => {
    const noStatus = { ...orders, columns: [orders.columns[0]!], rows: orders.rows.map((row) => ({ ...row, values: { amount: row.values.amount! } })) };
    expect(statusBreakdownNote(noStatus, sum)).toBeUndefined();
    const oneStatus = { ...orders, rows: orders.rows.map((row) => ({ ...row, values: { ...row.values, status: '결제완료' } })) };
    expect(statusBreakdownNote(oneStatus, sum)).toBeUndefined();
    expect(statusBreakdownNote({ ...orders, truncated: true }, sum)).toBeUndefined();
  });
});
