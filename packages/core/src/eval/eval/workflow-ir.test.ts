import { describe, it, expect } from 'vitest';
import { parseWorkflowIR, validateWorkflowIR } from '../../workflow/schema.js';
import { requiresApproval, validateApprovalPolicy, isDeployable } from '../../workflow/approval.js';
import { csMailWorkflowFixture, weeklyReportWorkflowFixture, dataPolicyFixture } from '../../testing/fixtures/workflows.js';

describe('Workflow IR', () => {
  it('validates fixtures', () => {
    expect(parseWorkflowIR(csMailWorkflowFixture).name).toBe('고객 문의 처리');
    expect(parseWorkflowIR(weeklyReportWorkflowFixture).trigger?.type).toBe('schedule');
    expect(parseWorkflowIR(dataPolicyFixture).dataPolicy.emailBody?.cloudAllowed).toBe(false);
  });

  it('enforces gmail send approval at the action boundary', () => {
    const bad = { ...csMailWorkflowFixture, steps: csMailWorkflowFixture.steps.filter((s) => s.type !== 'human_approval') };
    const errors = validateApprovalPolicy(bad);
    expect(errors).toEqual([]);
    expect(requiresApproval('EXTERNAL_HIGH', true)).toBe(true);
  });

  it('cs fixture is deployable', () => {
    expect(isDeployable(csMailWorkflowFixture)).toBe(true);
  });
});
