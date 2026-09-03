import { describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../../contract-validator.js';
import type { WorkflowIR } from '../../schema.js';
import { folderToDocument } from '../fixtures.js';
describe('AI output missing schema validation', () => {
  it('rejects AI output references when the decision has no output schema', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      steps: [
        { type: 'ai_decision', id: 'classify', goal: '위험도 분류', investigation: false, maxReads: 1 },
        { type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ops', text: '{{classify.riskLevel}}' }, sideEffect: 'EXTERNAL' },
      ],
      inputs: [],
      trigger: { type: 'manual' },
    };
    expect(validateWorkflowContracts(ir)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_workflow_reference', stepId: 'classify' }),
    ]));
  });
});
