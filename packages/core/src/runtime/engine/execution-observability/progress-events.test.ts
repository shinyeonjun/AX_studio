import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors } from '../../../modules/test-connectors.js';

describe('runtime progress event persistence', () => {
  it('reports and persists step progress while a workflow runs', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const progress: string[] = [];
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      onExecutionProgress: (event) => progress.push(`${event.stepId}:${event.status}`),
    });

    const result = await runtime.executeWorkflow(
      {
        name: '진행 상태 기록',
        goal: '단계 진행을 기록',
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
    expect(progress).toEqual(['notify:step_started', 'notify:step_completed']);
    const persistedLog = JSON.parse(store.getExecution(result.executionId)?.logJson ?? '[]') as Array<{
      code?: string;
    }>;
    expect(persistedLog.map((entry) => entry.code).filter((code): code is string => Boolean(code))).toEqual([
      'step_started',
      'step_completed',
    ]);
  });
});
