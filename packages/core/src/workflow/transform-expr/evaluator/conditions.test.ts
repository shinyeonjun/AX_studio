import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import { evaluateTransformExpr } from '../evaluator.js';
import { TransformExprSchema } from '../dsl.js';
import { ConditionExprSchema } from '../../condition-expr/schema.js';

describe('numeric transform conditions', () => {
  it('does not coerce null, blank strings, or booleans into numbers', () => {
    const table = buildTableArtifact({
      id: 'inventory',
      headers: ['stock'],
      matrix: [[20], [null], [''], ['  '], [true], ['10']],
    });
    const result = evaluateTransformExpr({
      op: 'filter',
      input: { op: 'source', sourceId: 'inventory' },
      where: { op: 'lt', left: { ref: 'stock' }, right: { lit: 30 } },
    }, { inventory: table });

    expect(result).toMatchObject({
      rows: [
        { values: { stock: 20 } },
        { values: { stock: 10 } },
      ],
    });
  });

  it('reads only own column and snapshot names', () => {
    const table = buildTableArtifact({ id: 'inventory', headers: ['stock'], matrix: [[1]] });
    expect(evaluateTransformExpr({ op: 'column', input: { op: 'source', sourceId: 'inventory' }, name: 'constructor' },
      { inventory: table })).toBeNull();
    expect(() => evaluateTransformExpr({ op: 'source', sourceId: 'toString' }, { inventory: table }))
      .toThrow('snapshot_not_found:toString');
  });

  it('rejects transform and condition expressions nested deeper than the limit', () => {
    let expr: unknown = { op: 'source', sourceId: 'inventory' };
    for (let index = 0; index < 100; index++) expr = { op: 'limit', input: expr, count: 1 };
    expect(TransformExprSchema.safeParse(expr).success).toBe(false);
    let condition: unknown = { op: 'eq', left: { ref: 'a' }, right: { lit: 1 } };
    for (let index = 0; index < 100; index++) condition = { op: 'not', arg: condition };
    expect(ConditionExprSchema.safeParse(condition).success).toBe(false);
    expect(TransformExprSchema.safeParse({ op: 'limit', input: { op: 'source', sourceId: 'x' }, count: 1 }).success).toBe(true);
  });
});

describe('sorting', () => {
  it('puts blank cells last in both directions and orders numeric text by value', async () => {
    const { evaluateTransformExpr } = await import('../evaluator.js');
    const { buildTableArtifact } = await import('../../../contracts/artifacts/table-build.js');
    const table = buildTableArtifact({
      id: 't', headers: ['name', 'revenue'], scalarPolicy: 'preserve',
      // DB decimals arrive as text; blanks are missing revenue.
      matrix: [['a', '9.50'], ['b', null], ['c', '100.00'], ['d', ''], ['e', 20]],
    });
    const order = (direction: 'asc' | 'desc') => (evaluateTransformExpr(
      { op: 'sort', input: { op: 'source', sourceId: 't' }, by: [{ column: 'revenue', direction }] }, { t: table },
    ) as typeof table).rows.map((row) => row.values.name);
    expect(order('desc').slice(0, 3)).toEqual(['c', 'e', 'a']);
    expect(order('asc').slice(0, 3)).toEqual(['a', 'e', 'c']);
    expect(order('desc').slice(3).sort()).toEqual(['b', 'd']);
    expect(order('asc').slice(3).sort()).toEqual(['b', 'd']);
  });
});
