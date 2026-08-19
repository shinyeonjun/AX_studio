import { describe, expect, it } from 'vitest';
import { insertContractAdapters } from './contract-adapters.js';
import { validateWorkflowContracts } from './contract-validator.js';
import type { WorkflowIR } from './schema.js';

describe('insertContractAdapters', () => {
  const base: WorkflowIR = {
    id: 'wf',
    name: 'Report',
    goal: '주간 보고',
    version: 1,
    trigger: { type: 'schedule', schedule: '0 17 * * 5', timezone: 'Asia/Seoul' },
    steps: [
      {
        type: 'action',
        id: 'read_sheet',
        connector: 'local_sheet',
        action: 'read',
        params: { path: './data/sales.csv' },
        sideEffect: 'NONE',
      },
      {
        type: 'action',
        id: 'slack_report',
        connector: 'slack',
        action: 'message.send',
        params: { channel: '#sales' },
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

  it('inserts table_to_text before slack send when only table data exists', () => {
    const adapted = insertContractAdapters(base);
    expect(adapted.steps.map((step) => step.id)).toEqual([
      'read_sheet',
      'adapter_transform_table_to_text_before_slack_report',
      'slack_report',
    ]);
    expect(validateWorkflowContracts(adapted)).toEqual([]);
  });

  it('inserts gmail read before slack send for gmail trigger workflows', () => {
    const gmailFlow: WorkflowIR = {
      ...base,
      trigger: { type: 'gmail.new_message', accountId: 'primary' },
      inputs: ['messageId'],
      steps: [
        {
          type: 'action',
          id: 'slack_notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#support' },
          sideEffect: 'EXTERNAL',
        },
      ],
    };
    const adapted = insertContractAdapters(gmailFlow);
    expect(adapted.steps.some((step) => step.connector === 'gmail' && step.action === 'messages.read')).toBe(true);
    expect(validateWorkflowContracts(adapted)).toEqual([]);
  });
});
