import { describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../../contract-validator.js';
import type { WorkflowIR } from '../../schema.js';
import { folderToDocument } from '../fixtures.js';
describe('AI output optional field validation', () => {
  it('rejects optional AI outputs used by downstream params or bindings', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '위험도 분류',
          outputSchema: {
            type: 'object',
            properties: { riskLevel: { type: 'string' }, summary: { type: 'string' } },
            required: ['riskLevel'],
          },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops' },
          bindings: { text: { from: 'classify', output: 'summary' } },
          sideEffect: 'EXTERNAL',
        },
      ],
      inputs: [],
    };
    expect(validateWorkflowContracts(ir)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_workflow_reference', stepId: 'classify', message: expect.stringContaining('required') }),
    ]));
  });
});
