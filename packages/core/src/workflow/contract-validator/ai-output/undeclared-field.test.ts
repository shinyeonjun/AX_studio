import { describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../../contract-validator.js';
import type { WorkflowIR } from '../../schema.js';
import { folderToDocument } from '../fixtures.js';
describe('AI output undeclared field validation', () => {
  it('rejects references to undeclared AI output fields', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '위험도 분류',
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } }, required: ['riskLevel'] },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: '{{classify.summary}}' },
          sideEffect: 'EXTERNAL',
        },
      ],
      inputs: [],
      trigger: { type: 'manual' },
    };
    expect(validateWorkflowContracts(ir).some((issue) => issue.code === 'invalid_workflow_reference')).toBe(true);
  });
});
