import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import { aggregateRows } from '../../workflow/transform-expr/evaluator/numeric.js';
import { OutputObservationSchema } from '../observation/schema.js';
import { enumerateCandidates } from './enumerator.js';
import { persistableActual, replayCandidates } from './replay-runner.js';

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function orders(rowCount: number, seed: number) {
  const random = seeded(seed);
  const matrix = Array.from({ length: rowCount }, (_, index) => [
    `O${index}`,
    ['가', '나', '다'][Math.floor(random() * 3)]!,
    Math.floor(random() * 100_000),
    1 + Math.floor(random() * 9),
  ]);
  return buildTableArtifact({ id: 'orders', headers: ['주문번호', '구분', '금액', '수량'], matrix, rowLimit: rowCount });
}

describe('discovery on large tables', () => {
  it('does not offer a single column as a number when the table has many rows', () => {
    const table = orders(500, 7);
    const observation = OutputObservationSchema.parse({
      id: 'obs-1', exampleId: 'ex-1', path: 'summary.합계', label: '합계',
      value: { kind: 'number', value: 1, display: '1' },
    });
    const candidates = enumerateCandidates([observation], [{ id: 'orders' } as never], { orders: table });
    expect(candidates.some(({ expr }) => expr.op === 'column')).toBe(false);
  });

  it('stores replay results at display size, whatever the table size', () => {
    for (const [rowCount, seed] of [[3_000, 11], [20_000, 12]] as const) {
      const table = orders(rowCount, seed);
      const total = aggregateRows(table.rows, { fn: 'sum', column: '금액' })!;
      const observation = OutputObservationSchema.parse({
        id: `obs-${seed}`, exampleId: 'ex-1', path: 'summary.합계', label: '합계', required: true,
        value: { kind: 'number', value: total, display: total.toLocaleString('en') },
      });
      const candidates = enumerateCandidates([observation], [{ id: 'orders' } as never], { orders: table });
      const replayed = replayCandidates({
        candidates,
        examples: [{ exampleId: 'ex-1', observations: [observation] }],
        snapshotsByExample: { 'ex-1': { orders: table } },
      });
      expect(replayed.some((candidate) => candidate.status === 'accepted')).toBe(true);
      expect(JSON.stringify(replayed).length).toBeLessThan(200_000);
    }
  });

  it('keeps small values and summarizes oversized ones', () => {
    expect(persistableActual(42)).toBe(42);
    expect(String(persistableActual('x'.repeat(5_000))).length).toBeLessThanOrEqual(501);
    const big = orders(1_000, 3);
    expect(persistableActual(big)).toEqual({ rowCount: 1_000, columns: big.columns });
  });

  it('cached aggregates equal a direct computation on every row array', () => {
    const random = seeded(99);
    for (let trial = 0; trial < 20; trial += 1) {
      const table = orders(1 + Math.floor(random() * 300), 1_000 + trial);
      const subset = table.rows.filter(() => random() < 0.5);
      for (const rows of [table.rows, subset]) {
        const amounts = rows.map((row) => row.values['금액'] as number);
        const sum = amounts.reduce((total, value) => total + value, 0);
        // Asked twice: the second answer comes from the cache and must not drift.
        for (let pass = 0; pass < 2; pass += 1) {
          expect(aggregateRows(rows, { fn: 'count' })).toBe(rows.length);
          expect(aggregateRows(rows, { fn: 'sum', column: '금액' })).toBe(amounts.length ? sum : null);
          expect(aggregateRows(rows, { fn: 'avg', column: '금액' })).toBe(amounts.length ? sum / amounts.length : null);
          expect(aggregateRows(rows, { fn: 'min', column: '금액' })).toBe(amounts.length ? amounts.reduce((a, b) => Math.min(a, b)) : null);
          expect(aggregateRows(rows, { fn: 'max', column: '금액' })).toBe(amounts.length ? amounts.reduce((a, b) => Math.max(a, b)) : null);
        }
      }
    }
  });

  it('aggregates very large columns without overflowing the call stack', () => {
    const rows = Array.from({ length: 300_000 }, (_, index) => ({ index, values: { v: index % 1000 } }));
    expect(aggregateRows(rows as never, { fn: 'max', column: 'v' })).toBe(999);
    expect(aggregateRows(rows as never, { fn: 'min', column: 'v' })).toBe(0);
  });
});
