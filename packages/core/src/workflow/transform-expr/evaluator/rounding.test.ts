import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import { evaluateTransformExpr } from '../evaluator.js';
import { TransformExprSchema } from '../dsl.js';
import { enumerateCandidates } from '../../../work-discovery/synthesis/enumerator.js';
import { OutputObservationSchema } from '../../../work-discovery/observation/schema.js';

const orders = buildTableArtifact({ id: 'orders', headers: ['금액', 'actual', 'target'], matrix: [[100, 1, 3], [101, 1, 3], [101, 1, 3]] });
const source = { op: 'source', sourceId: 'orders' } as const;

describe('aggregate and ratio rounding', () => {
  it('rounds an average half-up to the requested decimals', () => {
    expect(evaluateTransformExpr({ op: 'aggregate', input: source, fn: 'avg', column: '금액' }, { orders })).toBeCloseTo(100.6667, 3);
    expect(evaluateTransformExpr({ op: 'aggregate', input: source, fn: 'avg', column: '금액', round: 0 }, { orders })).toBe(101);
    expect(evaluateTransformExpr({ op: 'aggregate', input: source, fn: 'avg', column: '금액', round: 1 }, { orders })).toBe(100.7);
  });

  it('rounds a ratio and avoids binary float artifacts', () => {
    expect(evaluateTransformExpr({
      op: 'ratio',
      numerator: { op: 'aggregate', input: source, fn: 'sum', column: 'actual' },
      denominator: { op: 'aggregate', input: source, fn: 'sum', column: 'target' },
      multiplyBy: 100,
      round: 1,
    }, { orders })).toBe(33.3);
    const prices = buildTableArtifact({ id: 'prices', headers: ['v'], matrix: [[1.005]] });
    expect(evaluateTransformExpr({ op: 'aggregate', input: { op: 'source', sourceId: 'prices' }, fn: 'sum', column: 'v', round: 2 }, { prices })).toBe(1.01);
  });

  it('accepts only small whole-number precisions', () => {
    expect(TransformExprSchema.safeParse({ op: 'aggregate', input: source, fn: 'avg', column: '금액', round: 7 }).success).toBe(false);
    expect(TransformExprSchema.safeParse({ op: 'aggregate', input: source, fn: 'avg', column: '금액', round: 1.5 }).success).toBe(false);
  });

  it('finds a ratio between any numeric columns, whatever they are called', () => {
    const sales = buildTableArtifact({ id: 'sales', headers: ['지점', '실적', '목표'], matrix: [['A', 70, 80], ['B', 105, 120]] });
    const observation = OutputObservationSchema.parse({
      id: 'obs-r', exampleId: 'ex-1', path: 'summary.달성률', label: '달성률',
      value: { kind: 'number', value: 87.5, display: '87.5%', unit: '%' },
    });
    const candidates = enumerateCandidates([observation], [{ id: 'sales' } as never], { sales });
    const matching = candidates.filter(({ expr }) => evaluateTransformExpr(expr, { sales }) === 87.5);
    expect(matching.map(({ expr }) => expr)).toContainEqual(expect.objectContaining({
      op: 'ratio',
      numerator: expect.objectContaining({ column: '실적' }),
      denominator: expect.objectContaining({ column: '목표' }),
      multiplyBy: 100,
    }));
  });

  it('does not try ratios for whole numbers, where rounded ratios would match by coincidence', () => {
    const sales = buildTableArtifact({ id: 'sales', headers: ['실적', '목표'], matrix: [[70, 80], [105, 120]] });
    const observation = OutputObservationSchema.parse({
      id: 'obs-w', exampleId: 'ex-1', path: 'summary.건수', label: '건수',
      value: { kind: 'number', value: 88, display: '88' },
    });
    const candidates = enumerateCandidates([observation], [{ id: 'sales' } as never], { sales });
    expect(candidates.some(({ expr }) => expr.op === 'ratio')).toBe(false);
  });

  it('lets discovery propose an average rounded to the precision the report shows', () => {
    const observation = OutputObservationSchema.parse({
      id: 'obs-1', exampleId: 'ex-1', path: 'summary.평균주문금액', label: '평균주문금액',
      value: { kind: 'number', value: 58218, display: '58,218' },
    });
    const candidates = enumerateCandidates([observation], [{ id: 'orders' } as never], { orders });
    expect(candidates.map(({ expr }) => expr)).toContainEqual({ op: 'aggregate', input: source, fn: 'avg', column: '금액', round: 0 });
  });
});
