import { describe, expect, it } from 'vitest';
import type { TransformExpr } from '../../workflow/transform-expr/dsl.js';
import { collectInputColumns } from './compile-workflow/input-schema/collect.js';
import { renameExpr } from '../../workflow/repair/rewrite/expression.js';

const operation = (from: string, to: string) => ({
  id: 'r1', op: 'rename_column' as const, sourceId: 'input:orders', stepId: 's', from, to,
  expectedType: 'number', actualType: 'number', confidence: 1,
});

const group: TransformExpr = {
  op: 'group',
  input: {
    op: 'filter',
    input: { op: 'source', sourceId: 'input:orders' },
    where: { op: 'neq', left: { ref: 'state' }, right: { lit: 'void' } },
  },
  by: 'kind',
  aggregates: [{ as: 'kind_total', fn: 'sum', column: 'amount' }, { as: 'n', fn: 'count' }],
};

describe('group expressions across repair and compile', () => {
  it('renames source columns but never the published output headers', () => {
    const byRenamed = renameExpr(group, operation('kind', 'category'));
    expect(byRenamed.changed).toBe(true);
    expect(byRenamed.expr).toMatchObject({ by: 'category', keyAs: 'kind' });
    const measureRenamed = renameExpr(group, operation('amount', 'total'));
    expect(measureRenamed.expr).toMatchObject({ aggregates: [{ as: 'kind_total', column: 'total' }, { as: 'n' }] });
    const filterRenamed = renameExpr(group, operation('state', 'status'));
    expect(JSON.stringify(filterRenamed.expr)).toContain('"ref":"status"');
    expect(renameExpr(group, operation('n', 'x')).changed).toBe(false);
  });

  it('requires the group, measure and filter columns from the source', () => {
    const bucket = new Map();
    collectInputColumns(group, bucket);
    expect(Object.fromEntries(bucket.get('input:orders'))).toEqual({ kind: 'unknown', amount: 'number', state: 'unknown' });
  });
});
