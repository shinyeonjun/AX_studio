import { describe, expect, it } from 'vitest';
import { weeklyReportSkillFixture } from '../skill/fixtures.js';
import { createDatabaseAsync } from '../store/db.js';
import { SkillStore } from '../store/skill-store.js';
import { SkillRuntime } from './engine.js';
import { linearSteps } from './control-flow.js';
import type { SkillIR } from '../skill/schema.js';

describe('runtime control flow', () => {
  it('does not execute if-branch targets from the linear scan', () => {
    const ids = linearSteps(weeklyReportSkillFixture.steps).map((step) => step.id);
    expect(ids).toEqual(['read_sheet', 'analyze', 'if_drop']);
    expect(ids).not.toContain('slack_alert');
    expect(ids).not.toContain('slack_report');
  });

  it('runs exactly one slack branch for weekly report', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new SkillStore(db);
    const runtime = new SkillRuntime({ store, globalActive: true, skillActive: {} });
    const result = await runtime.executeSkill(weeklyReportSkillFixture, { ephemeral: true });
    expect(result.status).toBe('success');
    expect(runtime.mockSlack.messages).toHaveLength(1);
  });

  it('evaluates if conditions from trigger input', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new SkillStore(db);
    const runtime = new SkillRuntime({ store, globalActive: true, skillActive: {} });
    const ir: SkillIR = {
      name: '발신자 필터',
      goal: '특정 발신자만 알림',
      version: 1,
      steps: [
        {
          type: 'if',
          id: 'filter_sender',
          condition: "String(sender).includes('plosind@naver.com')",
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
    await runtime.executeSkill(ir, {
      ephemeral: true,
      input: { sender: 'plosind@naver.com', from: 'plosind@naver.com' },
    });
    expect(runtime.mockSlack.messages).toHaveLength(1);
  });

  it('resumes remaining steps after approval', async () => {
    const ir: SkillIR = {
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
    const store = new SkillStore(db);
    const runtime = new SkillRuntime({ store, globalActive: true, skillActive: {} });
    const first = await runtime.executeSkill(ir, { ephemeral: true });
    expect(first.status).toBe('pending_approval');
    expect(runtime.mockGmail.sent).toHaveLength(0);
    expect(runtime.mockSlack.messages).toHaveLength(0);

    const resumed = await runtime.continueAfterApproval(first.pendingApprovalId!);
    expect(resumed.status).toBe('success');
    expect(runtime.mockGmail.sent).toHaveLength(1);
    expect(runtime.mockSlack.messages).toHaveLength(1);
    expect(runtime.mockSlack.messages[0]?.channel).toBe('#ops');
  });
});
