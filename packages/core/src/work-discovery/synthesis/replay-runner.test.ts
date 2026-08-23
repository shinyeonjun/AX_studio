import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../modules/local-sheet/profile.js';
import { enumerateCandidates, replayCandidates } from './index.js';
import { evaluateTransformExpr } from './transform-evaluator.js';

describe('transform synthesis replay', () => {
  const table = buildTableArtifact({
    id: 'tbl_sales',
    headers: ['amount', 'product'],
    matrix: [[620000000, 'A'], [620000000, 'B']],
    source: { table: 'sales' },
  });
  const snapshots = { 'rdb:sales': table };

  it('matches SUM(amount) to observed 총매출', () => {
    const observations = [{
      id: 'obs_1',
      exampleId: 'ex_1',
      path: 'field.총매출',
      label: '총매출',
      value: { kind: 'number' as const, value: 1_240_000_000, display: '12.4억' },
      role: 'dynamic_value' as const,
      required: true,
    }];

    const candidates = enumerateCandidates(observations, [{
      id: 'rdb:sales',
      connector: 'rdb',
      label: 'sales',
      kind: 'table',
      relevance: 1,
    }], snapshots);

    const replayed = replayCandidates({
      candidates,
      examples: [{ exampleId: 'ex_1', observations }],
      snapshotsByExample: { ex_1: snapshots },
    });

    const winner = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' &&
      candidate.expr.fn === 'sum' &&
      candidate.replayResults.some((entry) => entry.pass),
    );
    expect(winner).toBeDefined();
    expect(evaluateTransformExpr({
      op: 'aggregate',
      input: { op: 'source', sourceId: 'rdb:sales' },
      fn: 'sum',
      column: 'amount',
    }, snapshots)).toBe(1_240_000_000);
  });
});
