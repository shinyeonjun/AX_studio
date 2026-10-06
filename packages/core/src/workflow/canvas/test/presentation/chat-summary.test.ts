import { describe, expect, it } from 'vitest';
import { renderChatSummary } from '../../presentation/chat-summary.js';
import type { WorkflowIR } from '../../../schema.js';

const sendMail = (params: Record<string, unknown>): Partial<WorkflowIR> => ({
  name: '테스트 메일 발송',
  goal: 'plosind@naver.com으로 테스트 메일을 보낸다',
  trigger: { type: 'once', runAt: '2026-08-19T10:00:00.000Z' },
  steps: [{
    type: 'action', id: 'send_mail', connector: 'gmail', action: 'message.send',
    actionRef: 'gmail.message.send@1', params, sideEffect: 'EXTERNAL_HIGH',
  }],
});

describe('renderChatSummary', () => {
  it('returns plain Korean summary instead of YAML document', () => {
    const summary = renderChatSummary(sendMail({ to: 'plosind@naver.com', subject: '테스트 메일', body: '테스트입니다.' }));
    expect(summary).toContain('테스트 메일 발송');
    expect(summary).toContain('plosind@naver.com');
    expect(summary).not.toContain('---');
    expect(summary).not.toContain('human_approval');
  });

  it('tells the user that external actions run after approval', () => {
    expect(renderChatSummary(sendMail({ to: 'plosind@naver.com' }))).toContain('외부 작업은 승인 후 실행됩니다.');
  });
});
