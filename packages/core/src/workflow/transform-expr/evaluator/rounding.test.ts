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

describe('totals over part of a table', () => {
  it('refuses to sum a later DB page as if it were the whole table', () => {
    const page = { ...buildTableArtifact({ id: 'page', headers: ['금액'], matrix: [[10], [20]] }),
      coverage: { schemaVersion: 1, page: 'complete', query: 'partial', source: 'partial', consistency: 'best_effort', reason: 'independent_offset_reads', observedRows: 2, hasMore: false } };
    expect(() => evaluateTransformExpr({ op: 'aggregate', input: { op: 'source', sourceId: 'page' }, fn: 'sum', column: '금액' }, { page: page as never }))
      .toThrow('incomplete_table_input');
  });
});

describe('numbers as people write them', () => {
  const sum = (values: unknown[], round?: number) => {
    const table = buildTableArtifact({ id: 't', headers: ['v'], matrix: values.map((value) => [value]), scalarPolicy: 'preserve' });
    return evaluateTransformExpr({ op: 'aggregate', input: { op: 'source', sourceId: 't' }, fn: 'sum', column: 'v', ...(round !== undefined ? { round } : {}) }, { t: table });
  };

  it('reads currency, 원, percent and accounting negatives; not hex', () => {
    expect(sum(['₩1,000', '2,000원', '(500)', '1.5e3'])).toBe(4000);
    expect(sum(['50%', '12.5%'])).toBe(62.5);
    expect(sum(['0x1F', 'abc'])).toBeNull();
  });

  it('rounds halves away from zero like spreadsheets, also for tiny values', () => {
    expect(sum([-0.125], 2)).toBe(-0.13);
    expect(sum([0.125], 2)).toBe(0.13);
    expect(sum([1.234e-7], 2)).toBe(0);
    expect(sum([-1.234e-7], 2)).toBe(0);
  });

  it('gives no ratio when a side has no numbers', () => {
    const table = buildTableArtifact({ id: 'r', headers: ['a', 'b'], matrix: [[null, 10], ['', 20]], scalarPolicy: 'preserve' });
    const source = { op: 'source', sourceId: 'r' } as const;
    expect(evaluateTransformExpr({
      op: 'ratio', multiplyBy: 100,
      numerator: { op: 'aggregate', input: source, fn: 'sum', column: 'a' },
      denominator: { op: 'aggregate', input: source, fn: 'sum', column: 'b' },
    }, { r: table })).toBeNull();
  });
});
