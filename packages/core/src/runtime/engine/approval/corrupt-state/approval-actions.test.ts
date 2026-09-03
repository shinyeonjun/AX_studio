import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import { createTestConnectors, mockGmail } from '../../../../modules/test-connectors.js';

describe('approval continuation corrupt state', () => {
  it.each([
    ['an unknown action', ['missing_action']],
    ['the same action more than once', ['send_mail', 'send_mail']],
  ])('fails closed when an approval references %s', async (_case, actionIds) => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const executionId = store.createExecution({
      workflowId: 'workflow-1',
      workflowVersion: 1,
      ephemeral: true,
      irJson: JSON.stringify({
        name: '승인 대상 검증',
        goal: '승인 대상 검증',
        steps: [{
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'send',
          params: { to: 'test@example.com', subject: 'test', body: 'test' },
          sideEffect: 'EXTERNAL',
        }],
        permissions: {},
        approval: ['gmail.send'],
        allowExternalAuto: true,
      }),
    });
    const approvalId = store.createApproval({ executionId, actionIds, reason: '승인 대상 확인' });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('invalid_approval_actions');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(store.getExecution(executionId)?.errorCode).toBe('invalid_approval_actions');
    expect(mockGmail(runtime.connectors).sent).toHaveLength(0);
  });
});
