import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { createTestConnectors } from '../../../modules/test-connectors.js';

describe('runtime execution records', () => {
  it('rejects malformed workflow input before contract evaluation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });

    const result = await runtime.executeWorkflow({ steps: 'not-an-array' } as unknown as WorkflowIR);

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('invalid_workflow_schema');
    expect(result.executionId).not.toBe('');
    expect(store.getExecution(result.executionId)).toMatchObject({
      status: 'failed',
      errorCode: 'invalid_workflow_schema',
    });
  });

  it('records preflight cancellation instead of hiding it from activity', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: false, workflowActive: {}, connectors: {} });

    const result = await runtime.executeWorkflow(
      { name: '퇴근 상태', goal: '실행하지 않음', version: 1, steps: [], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {} },
      { ephemeral: true, triggerType: 'manual' },
    );

    expect(result).toMatchObject({ status: 'cancelled', errorCode: 'global_off_duty' });
    expect(result.executionId).not.toBe('');
    expect(store.getExecution(result.executionId)).toMatchObject({
      status: 'cancelled',
      errorCode: 'global_off_duty',
      ephemeral: true,
    });
  });

  it('records an ephemeral run without creating a saved workflow reference', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
    });
    const result = await runtime.executeWorkflow(
      {
        id: 'draft-only-workflow',
        name: '일회 실행',
        goal: '한 번만 알림',
        version: 1,
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#once', text: 'done' },
            sideEffect: 'EXTERNAL',
          },
        ],
        permissions: {},
        approval: [],
        allowExternalAuto: true,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
      },
      { ephemeral: true, triggerType: 'manual', workspaceSessionId: 'chat-1' },
    );

    expect(result.status).toBe('success');
    expect(store.listWorkflows()).toHaveLength(0);
    expect(store.getExecution(result.executionId)).toMatchObject({
      workflowId: null,
      ephemeral: true,
      workspaceSessionId: 'chat-1',
      status: 'success',
    });
  });
});
