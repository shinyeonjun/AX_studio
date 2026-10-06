import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import { evaluateTransformExpr } from '../evaluator.js';
import { TransformExprSchema, type TransformExpr } from '../dsl.js';

const orders = buildTableArtifact({
  id: 'orders',
  headers: ['kind', 'amount', 'state'],
  matrix: [
    ['b ', 10, 'ok'],
    ['a', 5, 'ok'],
    [' b', 7, 'void'],
    ['', 100, 'ok'],
    [null, 100, 'ok'],
    ['c', 2.5, 'ok'],
    ['a', 6, 'ok'],
  ],
});
const source = { op: 'source', sourceId: 'orders' } as const;

function rows(result: unknown): Array<Record<string, unknown>> {
  return (result as TableArtifact).rows.map((row) => row.values);
}

describe('group transform', () => {
  it('groups trimmed non-empty keys in first-appearance order with aggregate semantics', () => {
    const result = evaluateTransformExpr({
      op: 'group',
      input: source,
      by: 'kind',
      keyAs: '구분',
      aggregates: [
        { as: 'n', fn: 'count' },
        { as: 'total', fn: 'sum', column: 'amount' },
        { as: 'mean', fn: 'avg', column: 'amount', round: 0 },
        { as: 'low', fn: 'min', column: 'amount' },
        { as: 'high', fn: 'max', column: 'amount' },
      ],
    }, { orders }) as TableArtifact;
    expect(result.kind).toBe('table');
    expect(result.columns.map((column) => column.name)).toEqual(['구분', 'n', 'total', 'mean', 'low', 'high']);
    expect(rows(result)).toEqual([
      { 구분: 'b', n: 2, total: 17, mean: 9, low: 7, high: 10 },
      { 구분: 'a', n: 2, total: 11, mean: 6, low: 5, high: 6 },
      { 구분: 'c', n: 1, total: 2.5, mean: 3, low: 2.5, high: 2.5 },
    ]);
  });

  it('appends a total row aggregated over every input row, after any filter', () => {
    const result = evaluateTransformExpr({
      op: 'group',
      input: { op: 'filter', input: source, where: { op: 'neq', left: { ref: 'state' }, right: { lit: 'void' } } },
      by: 'kind',
      aggregates: [{ as: 'n', fn: 'count' }, { as: 'total', fn: 'sum', column: 'amount' }],
      totalRow: { label: 'ALL' },
    }, { orders });
    expect(rows(result)).toEqual([
      { kind: 'b', n: 1, total: 10 },
      { kind: 'a', n: 2, total: 11 },
      { kind: 'c', n: 1, total: 2.5 },
      // Rows with an empty key are not a group but still count toward the total.
      { kind: 'ALL', n: 6, total: 223.5 },
    ]);
  });

  it('keeps keys as text and handles an empty input', () => {
    const codes = buildTableArtifact({ id: 'codes', headers: ['code', 'v'], matrix: [['001', 1], ['001 ', 2]], scalarPolicy: 'preserve' });
    expect(rows(evaluateTransformExpr({ op: 'group', input: { op: 'source', sourceId: 'codes' }, by: 'code', aggregates: [{ as: 's', fn: 'sum', column: 'v' }] }, { codes })))
      .toEqual([{ code: '001', s: 3 }]);
    const empty = buildTableArtifact({ id: 'empty', headers: ['code', 'v'], matrix: [] });
    expect(rows(evaluateTransformExpr({
      op: 'group', input: { op: 'source', sourceId: 'empty' }, by: 'code',
      aggregates: [{ as: 'n', fn: 'count' }, { as: 's', fn: 'sum', column: 'v' }], totalRow: { label: 'T' },
    }, { empty }))).toEqual([{ code: 'T', n: 0, s: null }]);
  });

  it('refuses incomplete inputs and duplicate output headers', () => {
    const partial = { ...orders, truncated: true };
    const expr: TransformExpr = { op: 'group', input: source, by: 'kind', aggregates: [{ as: 'n', fn: 'count' }] };
    expect(() => evaluateTransformExpr(expr, { orders: partial })).toThrow('incomplete_table_input');
    expect(() => evaluateTransformExpr({ ...expr, aggregates: [{ as: 'kind', fn: 'count' }] }, { orders }))
      .toThrow('group_duplicate_output_column');
  });

  it('validates the stored shape', () => {
    const valid = { op: 'group', input: source, by: 'kind', aggregates: [{ as: 'n', fn: 'count' }], totalRow: { label: '합계' } };
    expect(TransformExprSchema.safeParse(valid).success).toBe(true);
    expect(TransformExprSchema.safeParse({ ...valid, aggregates: [] }).success).toBe(false);
    expect(TransformExprSchema.safeParse({ ...valid, aggregates: [{ as: 'n', fn: 'median' }] }).success).toBe(false);
    expect(TransformExprSchema.safeParse({ ...valid, aggregates: [{ as: 'n', fn: 'avg', column: 'amount', round: 7 }] }).success).toBe(false);
    const many = Array.from({ length: 33 }, (_, index) => ({ as: `m${index}`, fn: 'count' }));
    expect(TransformExprSchema.safeParse({ ...valid, aggregates: many }).success).toBe(false);
    expect(TransformExprSchema.safeParse({ ...valid, by: '' }).success).toBe(false);
  });
});
