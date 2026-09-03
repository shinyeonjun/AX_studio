import { describe, expect, it } from 'vitest';
import { enumerateCandidates, replayCandidates, resolveReplayWinners } from '../../../../work-discovery/synthesis/index.js';
import { buildTableArtifact } from '../../../../contracts/artifacts/table-build.js';

describe('work discovery correctness regressions', () => {
  it('rejects ANY-pass candidates across multiple examples', () => {
    const tableJune = buildTableArtifact({
      id: 'tbl_june',
      headers: ['amount', 'product_id'],
      matrix: [[100, 1], [100, 2]],
    });
    const tableJuly = buildTableArtifact({
      id: 'tbl_july',
      headers: ['amount', 'product_id'],
      matrix: [[50, 1], [150, 2]],
    });
    const sourceId = 'input:sales';
    const observations = [
      {
        id: 'obs_june',
        exampleId: 'ex_june',
        path: 'field.총매출',
        label: '총매출',
        value: { kind: 'number' as const, value: 200, display: '200' },
        role: 'dynamic_value' as const,
        required: true,
      },
      {
        id: 'obs_july',
        exampleId: 'ex_july',
        path: 'field.총매출',
        label: '총매출',
        value: { kind: 'number' as const, value: 200, display: '200' },
        role: 'dynamic_value' as const,
        required: true,
      },
    ];
    const sources = [{ id: sourceId, connector: 'input_artifact', label: 'sales', kind: 'workbook' as const, relevance: 1 }];
    const candidates = enumerateCandidates(observations, sources, { [sourceId]: tableJune });
    const replayedRaw = replayCandidates({
      candidates,
      examples: [
        { exampleId: 'ex_june', observations: [observations[0]!] },
        { exampleId: 'ex_july', observations: [observations[1]!] },
      ],
      snapshotsByExample: {
        ex_june: { [sourceId]: tableJune },
        ex_july: { [sourceId]: tableJuly },
      },
    });
    const { candidates: replayed } = resolveReplayWinners(replayedRaw, ['field.총매출']);
    const sumAmount = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' && candidate.expr.fn === 'sum' && candidate.expr.column === 'amount',
    );
    const sumProduct = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' && candidate.expr.fn === 'sum' && candidate.expr.column === 'product_id',
    );
    expect(sumAmount?.status).toBe('accepted');
    expect(sumProduct?.status).not.toBe('accepted');
  });

  it('rejects aggregate replay on truncated snapshots', () => {
    const truncated = buildTableArtifact({
      id: 'tbl_trunc',
      headers: ['amount'],
      matrix: [[100], [100]],
      rowLimit: 2,
      source: { table: 'sales', queryFingerprint: 'limited' },
    });
    truncated.truncated = true;
    const observations = [{
      id: 'obs_1',
      exampleId: 'ex_1',
      path: 'field.총매출',
      label: '총매출',
      value: { kind: 'number' as const, value: 999999, display: '999999' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    const replayed = replayCandidates({
      candidates: enumerateCandidates(observations, [{ id: 'rdb:sales', connector: 'rdb', label: 'sales', kind: 'table', relevance: 1 }], { 'rdb:sales': truncated }),
      examples: [{ exampleId: 'ex_1', observations }],
      snapshotsByExample: { ex_1: { 'rdb:sales': truncated } },
    });
    expect(replayed.every((candidate) => candidate.status !== 'accepted')).toBe(true);
  });

});
