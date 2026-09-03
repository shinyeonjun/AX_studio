import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors } from '../../../modules/test-connectors.js';

describe('runtime observer failure isolation', () => {
  it('keeps observer failures from changing execution outcomes', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      onExecutionStarted: () => { throw new Error('start observer failed'); },
      onExecutionProgress: () => { throw new Error('progress observer failed'); },
      onExecutionFinished: () => { throw new Error('finish observer failed'); },
    });

    const result = await runtime.executeWorkflow(
      {
        name: '관찰자 실패 격리',
        goal: '실행 결과는 관찰자와 독립적이어야 한다',
        version: 1,
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#progress', text: 'done' },
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
      { ephemeral: true, triggerType: 'manual' },
    );

    expect(result.status).toBe('success');
    expect(store.getExecution(result.executionId)).toMatchObject({ status: 'success' });
  });
});
