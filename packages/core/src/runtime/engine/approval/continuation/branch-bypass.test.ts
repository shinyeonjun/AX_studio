import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { createTestConnectors, mockGmail } from '../../../../modules/test-connectors.js';

describe('approval continuation branch guard', () => {
  it('does not let a high-side-effect action bypass approval when a branch skips its approval node', async () => {
    const ir: WorkflowIR = {
      name: '분기 승인 우회 방지',
      goal: '분기에서 메일을 승인 후 발송',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'branch',
          condition: { op: 'eq', left: { ref: 'flag' }, right: { lit: true } },
          thenStepIds: ['send_mail'],
          elseStepIds: [],
        },
        {
          type: 'human_approval',
          id: 'unused_approval',
          reason: '메일 발송',
          forActionIds: ['send_mail'],
        },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: { to: 'a@b.com', body: 'approved body' },
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
    const first = await runtime.executeWorkflow(ir, { ephemeral: true, input: { flag: true } });

    expect(first.status).toBe('pending_approval');
    expect(mockGmail(runtime.connectors).sent).toHaveLength(0);

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);

    expect(resumed.status).toBe('success');
    expect(mockGmail(runtime.connectors).sent).toHaveLength(1);
  });
});
