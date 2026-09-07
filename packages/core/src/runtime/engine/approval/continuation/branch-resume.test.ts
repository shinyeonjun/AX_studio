import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { createTestConnectors, mockSlack } from '../../../../testing/connectors/test-connectors.js';

describe('approval continuation branch resume', () => {
  it.each([true, false])('resumes outer steps after branch approval, inner followup=%s', async (innerFollowup) => {
    const ir: WorkflowIR = {
      name: '분기 승인 후 후속',
      goal: '조건 분기 승인 뒤 바깥 단계 실행',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'branch',
          condition: { op: 'eq', left: { ref: 'flag' }, right: { lit: true } },
          thenStepIds: innerFollowup ? ['approve_branch', 'branch_followup'] : ['approve_branch'],
          elseStepIds: [],
        },
        {
          type: 'human_approval',
          id: 'approve_branch',
          reason: '분기 작업 승인',
          forActionIds: ['branch_action'],
        },
        {
          type: 'action',
          id: 'branch_action',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#branch', text: 'inside' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'action',
          id: 'branch_followup',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#branch-follow', text: 'after branch' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'action',
          id: 'outer_tail',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#tail', text: 'outer done' },
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

    if (!innerFollowup) ir.steps = ir.steps.filter(step => step.id !== 'branch_followup');
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const first = await runtime.executeWorkflow(ir, {
      ephemeral: true,
      input: { flag: true },
    });
    expect(first.status).toBe('pending_approval');
    expect(store.getExecution(first.executionId)?.status).toBe('pending_approval');

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);
    expect(resumed.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages.map((m) => m.channel)).toEqual(
      innerFollowup ? ['#branch', '#branch-follow', '#tail'] : ['#branch', '#tail'],
    );
    db.close?.();
  });
});
