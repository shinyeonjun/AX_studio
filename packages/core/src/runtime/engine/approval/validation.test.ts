import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../modules/test-connectors.js';

describe('approval continuation validation', () => {
  it('fails approval continuation when gmail body is missing', async () => {
    const ir: WorkflowIR = {
      name: '본문 없는 메일',
      goal: '메일 보내기',
      version: 1,
      steps: [
        {
          type: 'human_approval',
          id: 'approve_send',
          reason: '메일 발송',
          forActionIds: ['send_mail'],
        },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: { to: 'a@b.com', subject: 'hi' },
          sideEffect: 'EXTERNAL_HIGH',
        },
      ],
      permissions: {},
      approval: ['gmail.send'],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const first = await runtime.executeWorkflow(ir, { ephemeral: true });

    expect(first.status).toBe('failed');
    expect(first.errorCode).toBe('action_params_missing');
    expect(store.getPendingApprovals()).toHaveLength(0);
  });

  it('resolves approval and reports failure when required params stay missing', async () => {
    const ir: WorkflowIR = {
      name: '수신자 없는 메일',
      goal: '메일 보내기',
      version: 1,
      steps: [
        {
          type: 'human_approval',
          id: 'approve_send',
          reason: '메일 발송',
          forActionIds: ['send_mail'],
        },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: { subject: 'hi' },
          sideEffect: 'EXTERNAL_HIGH',
        },
      ],
      permissions: {},
      approval: ['gmail.send'],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const first = await runtime.executeWorkflow(ir, { ephemeral: true });

    expect(first.status).toBe('failed');
    expect(first.errorCode).toBe('action_params_missing');
    expect(store.getPendingApprovals()).toHaveLength(0);
  });


});
