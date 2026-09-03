import { describe, expect, it } from 'vitest';
import { enumerateCandidates, replayCandidates } from '../../../../work-discovery/synthesis/index.js';
import { buildTableArtifact } from '../../../../contracts/artifacts/table-build.js';

describe('work discovery correctness regressions', () => {
  it('fails closed on schema rename without silent wrong column selection', () => {
    const renamed = buildTableArtifact({
      id: 'tbl_renamed',
      headers: ['sales_amount', 'actual', 'target'],
      matrix: [[100, 50, 80]],
    });
    const observations = [{
      id: 'obs_amount',
      exampleId: 'ex_1',
      path: 'field.총매출',
      label: '총매출',
      value: { kind: 'number' as const, value: 100, display: '100' },
      role: 'dynamic_value' as const,
      required: true,
    }];
    const replayed = replayCandidates({
      candidates: enumerateCandidates(observations, [{ id: 'input:sales', connector: 'input_artifact', label: 'sales', kind: 'workbook', relevance: 1 }], { 'input:sales': renamed }),
      examples: [{ exampleId: 'ex_1', observations }],
      snapshotsByExample: { ex_1: { 'input:sales': renamed } },
    });
    const amountWinner = replayed.find((candidate) =>
      candidate.expr.op === 'aggregate' && candidate.expr.fn === 'sum' && candidate.expr.column === 'amount' && candidate.status === 'accepted',
    );
    expect(amountWinner).toBeUndefined();
  });
});
