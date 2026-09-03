import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { createTestConnectors, mockGmail, mockSlack } from '../../../../modules/test-connectors.js';

describe('approval continuation direct resume', () => {
  it('resumes remaining steps after approval', async () => {
    const ir: WorkflowIR = {
      name: '승인 후 보고',
      goal: '보내고 알림',
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
          params: { to: 'a@b.com', body: 'hi' },
          sideEffect: 'EXTERNAL_HIGH',
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: 'sent' },
          sideEffect: 'EXTERNAL',
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
    expect(first.status).toBe('pending_approval');
    expect(store.getExecution(first.executionId)).toMatchObject({
      status: 'pending_approval',
      errorCode: 'pending_approval',
      finishedAt: null,
    });
    expect(mockGmail(runtime.connectors).sent).toHaveLength(0);
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

    const [resumed, duplicate] = await Promise.all([
      runtime.continueAfterApproval(first.pendingApprovalId!),
      runtime.continueAfterApproval(first.pendingApprovalId!),
    ]);
    expect(resumed.status).toBe('success');
    expect(['approval_in_progress', 'approval_already_resolved']).toContain(duplicate.errorCode);
    expect(mockGmail(runtime.connectors).sent).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    expect(mockSlack(runtime.connectors).messages[0]?.channel).toBe('#ops');
  });
});
