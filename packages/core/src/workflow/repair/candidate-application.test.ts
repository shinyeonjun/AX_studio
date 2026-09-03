import { describe, expect, it } from 'vitest';
import { applyRepairCandidate, repairProtectedFingerprint, suggestRepairCandidates } from '../repair.js';
import { actualTable, contract, stepId, workflowFixture } from './fixtures.js';

describe('conservative workflow repair', () => {
  it('changes only the selected mapping and preserves policy and side-effect meaning', () => {
    const workflow = workflowFixture();
    const candidate = suggestRepairCandidates(contract, stepId, actualTable)[0]!;
    const repaired = applyRepairCandidate(workflow, candidate);

    expect(repaired.version).toBe(workflow.version);
    expect(repaired.approval).toEqual(workflow.approval);
    expect(repaired.trigger).toEqual(workflow.trigger);
    expect(repaired.sideEffects).toEqual(workflow.sideEffects);
    expect(repaired.dataPolicy).toEqual(workflow.dataPolicy);
    expect(repaired.steps[1]).toMatchObject({
      type: 'action',
      params: {
        expr: {
          op: 'aggregate',
          column: 'customers',
        },
      },
    });
    expect(repaired.outputContract?.inputSchemas[0]?.columns).toEqual([
      { name: 'customers', type: 'number' },
      { name: 'status', type: 'string' },
    ]);
    const document = JSON.parse(repaired.document ?? '{}') as { fields?: Array<{ mapping?: { column?: string } }> };
    expect(document.fields?.[0]?.mapping?.column).toBe('customers');
    expect(repairProtectedFingerprint(workflow, candidate)).toBe(
      repairProtectedFingerprint(repaired, candidate),
    );
  });
});
