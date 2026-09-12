import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { createTestConnectors, mockSlack } from '../../../../testing/connectors/test-connectors.js';

describe('approval continuation branch resume', () => {
  it.each([true, false])('resumes outer steps after branch approval, inner followup=%s', async (innerFollowup) => {
    const ir: WorkflowIR = { inputs: [],
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

it.each([true, false])('defers approval-owned descendant action to nested branch selection: %s', async (send) => {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
  const ir: WorkflowIR = { inputs: [],
    name: 'Nested conditional approved action', goal: 'Send only once when nested condition is true', version: 1,
    steps: [
      { type: 'if', id: 'outer', condition: { op: 'eq', left: { ref: 'enter' }, right: { lit: true } }, thenStepIds: ['approve', 'inner'], elseStepIds: [] },
      { type: 'human_approval', id: 'approve', reason: 'Approve possible send', forActionIds: ['send'] },
      { type: 'if', id: 'inner', condition: { op: 'eq', left: { ref: 'shouldSend' }, right: { lit: true } }, thenStepIds: ['send'], elseStepIds: [] },
      { type: 'action', id: 'send', connector: 'slack', action: 'message.send', params: { channel: '#nested', text: 'once' }, sideEffect: 'EXTERNAL' },
    ],
    permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
  };
  try {
    const first = await runtime.executeWorkflow(ir, { ephemeral: true, input: { enter: true, shouldSend: send } });
    expect(first.status).toBe('pending_approval');
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);
    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);
    expect(resumed.status).toBe('success');
    expect(mockSlack(runtime.connectors).messages).toHaveLength(send ? 1 : 0);
  } finally {
    db.close?.();
  }
});
