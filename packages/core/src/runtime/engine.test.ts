import { describe, expect, it } from 'vitest';
import { weeklyReportWorkflowFixture } from '../workflow/fixtures.js';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import { WorkflowRuntime } from './engine.js';
import { linearSteps } from './control-flow.js';
import type { WorkflowIR } from '../workflow/schema.js';

describe('runtime control flow', () => {
  it('does not execute if-branch targets from the linear scan', () => {
    const ids = linearSteps(weeklyReportWorkflowFixture.steps).map((step) => step.id);
    expect(ids).toEqual(['read_sheet', 'analyze', 'if_drop']);
    expect(ids).not.toContain('slack_alert');
    expect(ids).not.toContain('slack_report');
  });

  it('runs exactly one slack branch for weekly report', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const result = await runtime.executeWorkflow(weeklyReportWorkflowFixture, { ephemeral: true });
    expect(result.status).toBe('success');
    expect(runtime.mockSlack.messages).toHaveLength(1);
  });

  it('evaluates if conditions from trigger input', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const ir: WorkflowIR = {
      name: '발신자 필터',
      goal: '특정 발신자만 알림',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'filter_sender',
          condition: { op: 'contains', left: { ref: 'sender' }, right: { lit: 'plosind@naver.com' } },
          thenStepIds: ['notify'],
          elseStepIds: [],
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#inbox', text: 'matched' },
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
    await runtime.executeWorkflow(ir, {
      ephemeral: true,
      input: { sender: 'plosind@naver.com', from: 'plosind@naver.com' },
    });
    expect(runtime.mockSlack.messages).toHaveLength(1);
  });

  it('resumes remaining steps after approval', async () => {
    const ir: WorkflowIR = {
      name: '승인 후 보고',
      goal: '보내고 알림',
      version: 1,
      steps: [
        {
          type: 'human_approval',
          id: 'approve_send',
          reason: '메일 발송',
          forActionIds: ['send_mail'],
        },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: { to: 'a@b.com', body: 'hi' },
          sideEffect: 'EXTERNAL_HIGH',
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: 'sent' },
          sideEffect: 'EXTERNAL',
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
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const first = await runtime.executeWorkflow(ir, { ephemeral: true });
    expect(first.status).toBe('pending_approval');
    expect(runtime.mockGmail.sent).toHaveLength(0);
    expect(runtime.mockSlack.messages).toHaveLength(0);

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);
    expect(resumed.status).toBe('success');
    expect(runtime.mockGmail.sent).toHaveLength(1);
    expect(runtime.mockSlack.messages).toHaveLength(1);
    expect(runtime.mockSlack.messages[0]?.channel).toBe('#ops');
  });

  it('resumes outer steps after approval inside an if branch', async () => {
    const ir: WorkflowIR = {
      name: '분기 승인 후 후속',
      goal: '조건 분기 승인 뒤 바깥 단계 실행',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'branch',
          condition: { op: 'eq', left: { ref: 'flag' }, right: { lit: true } },
          thenStepIds: ['approve_branch', 'branch_followup'],
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

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {} });
    const first = await runtime.executeWorkflow(ir, {
      ephemeral: true,
      input: { flag: true },
    });
    expect(first.status).toBe('pending_approval');

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);
    expect(resumed.status).toBe('success');
    expect(runtime.mockSlack.messages.map((m) => m.channel)).toEqual(['#branch', '#branch-follow', '#tail']);
  });
});
