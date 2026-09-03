import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import { createTestConnectors, mockSlack } from '../../../modules/test-connectors.js';

describe('runtime control-flow normal completion', () => {
  it('does not execute outer steps twice after a branch completes normally', async () => {
    const ir: WorkflowIR = {
      name: '정상 분기 후속 실행',
      goal: '분기와 바깥 후속 알림을 각각 한 번 실행',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'branch',
          condition: { op: 'eq', left: { ref: 'flag' }, right: { lit: true } },
          thenStepIds: ['branch_notify'],
          elseStepIds: [],
        },
        {
          type: 'action',
          id: 'branch_notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#branch', text: 'inside' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'action',
          id: 'outer_tail',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#tail', text: 'outside' },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const result = await runtime.executeWorkflow(ir, { ephemeral: true, input: { flag: true } });

    expect(result.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages.map((message) => message.channel)).toEqual(['#branch', '#tail']);
  });
});
