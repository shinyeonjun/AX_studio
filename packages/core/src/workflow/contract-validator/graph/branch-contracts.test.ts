import { describe, expect, it } from 'vitest';
import { inferWorkflowBindings } from '../../bindings.js';
import { validateWorkflowContracts } from '../../contract-validator.js';
import { folderToDocument } from '../fixtures.js';
import type { WorkflowIR } from '../../schema.js';

describe('validateWorkflowContracts graph and control flow', () => {
  it('rejects steps after IF when only one branch produces required contracts', () => {
    const ir: WorkflowIR = {
      id: 'wf-if',
      name: 'Branching',
      goal: 'test',
      version: 1,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'action',
          id: 'read_sheet',
          connector: 'local_sheet',
          action: 'read',
          params: { path: './data.csv' },
          sideEffect: 'NONE',
        },
        {
          type: 'if',
          id: 'branch',
          condition: 'true',
          thenStepIds: ['to_text'],
          elseStepIds: [],
        },
        {
          type: 'action',
          id: 'to_text',
          connector: 'transform',
          action: 'table_to_text',
          params: {},
          sideEffect: 'NONE',
        },
        {
          type: 'action',
          id: 'send',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops' },
          sideEffect: 'EXTERNAL',
        },
      ],
      inputs: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const adapted = inferWorkflowBindings(ir);
    const issues = validateWorkflowContracts(adapted);
    expect(issues.some((issue) => issue.stepId === 'send')).toBe(true);
  });
});
