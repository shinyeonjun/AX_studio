import { describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../../contract-validator.js';
import { folderToDocument } from '../fixtures.js';
import type { WorkflowIR } from '../../schema.js';

describe('validateWorkflowContracts graph and control flow', () => {
  it('rejects a classified workflow that sends every notification linearly', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '위험도 분류',
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'critical',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#critical', text: '{{classify.riskLevel}}' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'action',
          id: 'normal',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#normal', text: '{{classify.riskLevel}}' },
          sideEffect: 'EXTERNAL',
        },
      ],
      trigger: { type: 'manual' },
      inputs: [],
    };

    expect(validateWorkflowContracts(ir).some((issue) => issue.code === 'invalid_control_flow')).toBe(true);
  });

  it('rejects cyclic if branches before recursive contract validation', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'if',
          id: 'root',
          condition: 'true',
          thenStepIds: ['branch_a'],
          elseStepIds: [],
        },
        {
          type: 'if',
          id: 'branch_a',
          condition: 'true',
          thenStepIds: ['notify'],
          elseStepIds: ['branch_b'],
        },
        {
          type: 'if',
          id: 'branch_b',
          condition: 'false',
          thenStepIds: ['notify'],
          elseStepIds: ['branch_a'],
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'document',
          action: 'pdf.generate',
          actionRef: 'document.pdf.generate',
          params: {},
          sideEffect: 'REVERSIBLE',
        },
      ],
    };

    expect(validateWorkflowContracts(ir)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_control_flow', stepId: 'branch_a' }),
      ]),
    );
  });
});
