import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import { enumerateCandidates, replayCandidates } from './index.js';
import { evaluateTransformExpr } from '../../workflow/transform-expr/evaluator.js';

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

  it('fails closed when a required observation is missing from one example', () => {
    const observations = [{
      id: 'obs_required',
      exampleId: 'ex_1',
      path: 'field.총매출',
      label: '총매출',
      value: { kind: 'number' as const, value: 1_240_000_000, display: '12.4억' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    const source = {
      id: 'rdb:sales',
      connector: 'rdb',
      label: 'sales',
      kind: 'table' as const,
      relevance: 1,
    };
    const candidates = enumerateCandidates(observations, [source], snapshots);
    const replayed = replayCandidates({
      candidates,
      examples: [
        { exampleId: 'ex_1', observations },
        { exampleId: 'ex_2', observations: [] },
      ],
      snapshotsByExample: {
        ex_1: snapshots,
        ex_2: snapshots,
      },
    });

    const sumAmount = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' && candidate.expr.fn === 'sum' && candidate.expr.column === 'amount',
    );
    expect(sumAmount?.replayResults).toHaveLength(2);
    expect(sumAmount?.replayResults[1]).toMatchObject({
      exampleId: 'ex_2',
      actual: null,
      match: 0,
      pass: false,
    });
    expect(sumAmount?.status).not.toBe('accepted');
  });

  it('keeps an absent optional observation out of replay failures', () => {
    const observations = [{
      id: 'obs_optional',
      exampleId: 'ex_1',
      path: 'field.optional',
      label: '선택값',
      value: { kind: 'number' as const, value: 1_240_000_000, display: '12.4억' },
      role: 'dynamic_value' as const,
      required: false,
    }];
    const candidates = enumerateCandidates(observations, [{
      id: 'rdb:sales',
      connector: 'rdb',
      label: 'sales',
      kind: 'table' as const,
      relevance: 1,
    }], snapshots);
    const replayed = replayCandidates({
      candidates,
      examples: [
        { exampleId: 'ex_1', observations },
        { exampleId: 'ex_2', observations: [] },
      ],
      snapshotsByExample: {
        ex_1: snapshots,
        ex_2: snapshots,
      },
    });

    const sumAmount = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' && candidate.expr.fn === 'sum' && candidate.expr.column === 'amount',
    );
    expect(sumAmount?.replayResults).toHaveLength(0);
    expect(sumAmount?.status).toBe('candidate');
  });
});
