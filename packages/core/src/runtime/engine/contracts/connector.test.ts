import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../persistence/db.js';
import { WorkflowStore } from '../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';

describe('runtime engine connector guards', () => {
  it('fails closed when a real connector was not configured', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const result = await runtime.executeWorkflow(
      { inputs: [],
        name: '연결 누락',
        goal: '가짜 전송 금지',
        version: 1,
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#ops', text: 'must fail' },
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
      { ephemeral: true },
    );

    expect(result.status).toBe('failed');
    expect(result.errorCode).toBe('connector_missing');
  });
});
