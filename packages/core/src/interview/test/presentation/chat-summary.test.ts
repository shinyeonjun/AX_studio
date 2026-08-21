import { describe, expect, it } from 'vitest';
import { renderChatSummary } from '../../presentation/chat-summary.js';
import { buildIRFromWorkflow } from '../../compile/builder.js';

describe('renderChatSummary', () => {
  it('returns plain Korean summary instead of YAML document', () => {
    const ir = buildIRFromWorkflow({
      name: '테스트 메일 발송',
      goal: 'plosind@naver.com으로 테스트 메일을 보낸다',
      triggerType: 'once',
      runAt: '2026-08-19T10:00:00.000Z',
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'send',
          params: { to: 'plosind@naver.com', subject: '테스트 메일', body: '테스트입니다.' },
        },
      ],
    });
    const summary = renderChatSummary(ir);
    expect(summary).toContain('테스트 메일 발송');
    expect(summary).toContain('plosind@naver.com');
    expect(summary).not.toContain('---');
    expect(summary).not.toContain('human_approval');
  });
});

describe('workflow builder approvals', () => {
  it('creates one friendly approval per high-risk action', () => {
    const ir = buildIRFromWorkflow({
      name: '테스트 메일 발송',
      goal: '보내기',
      triggerType: 'once',
      runAt: '2026-08-19T10:00:00.000Z',
      assumptions: [],
      nodes: [
        { type: 'human_approval', id: 'approve_generic', reason: '실행 전 승인', forActionIds: [] },
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'send',
          params: { to: 'plosind@naver.com' },
        },
      ],
    });
    const approvals = ir.steps?.filter((step) => step.type === 'human_approval') ?? [];
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.type === 'human_approval' && approvals[0].reason).toContain('테스트 메일 발송');
    expect(approvals[0]?.type === 'human_approval' && approvals[0].forActionIds).toEqual(['send_mail']);
  });
});

describe('workflow trigger filters', () => {
  it('stores the agent-provided filter on the trigger', () => {
    const ir = buildIRFromWorkflow({
      name: '조건부 알림',
      goal: '특정 발신자 메일 알림',
      triggerType: 'gmail.new_message',
      gmailAccount: 'primary',
      triggerFilter: {
        op: 'eq',
        left: { ref: 'from' },
        right: { lit: 'sender@example.com' },
      },
      assumptions: [],
      nodes: [],
    });

    expect(ir.trigger).toMatchObject({
      type: 'gmail.new_message',
      accountId: 'primary',
      filter: {
        op: 'eq',
        left: { ref: 'from' },
        right: { lit: 'sender@example.com' },
      },
    });
  });
});
