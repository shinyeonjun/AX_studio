import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { createTestConnectors, mockSlack } from '../../../../modules/test-connectors.js';

describe('approval continuation global execution guard', () => {
  it('does not resume an external approval while global execution is off', async () => {
    const ir: WorkflowIR = {
      name: '퇴근 승인 차단',
      goal: '전역 실행 중지 중에는 승인 후 전송하지 않음',
      version: 1,
      steps: [
        {
          type: 'action',
          id: 'send_alert',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: 'must wait' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });

    const first = await runtime.executeWorkflow(ir, { ephemeral: true });
    expect(first.status).toBe('pending_approval');
    runtime.setGlobalActive(false);

    const blocked = await runtime.continueAfterApproval(first.pendingApprovalId!);

    expect(blocked).toMatchObject({ status: 'cancelled', errorCode: 'global_off_duty' });
    expect(store.getApproval(first.pendingApprovalId!)?.status).toBe('pending');
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);
  });
});
