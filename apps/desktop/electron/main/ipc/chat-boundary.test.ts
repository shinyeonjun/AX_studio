import { describe, expect, it } from 'vitest';
import { normalizeChatMessages } from './chat-boundary.js';

describe('workspace chat boundary', () => {
  it('does not accept execution status on an ordinary assistant message', () => {
    expect(() => normalizeChatMessages([
      { role: 'assistant', content: '일반 답변', executionStatus: 'success' },
    ])).toThrow();
  });

  it('preserves typed status on an execution result message', () => {
    expect(normalizeChatMessages([
      {
        role: 'assistant',
        content: '실행 결과',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'success',
      },
    ])).toEqual([
      {
        role: 'assistant',
        content: '실행 결과',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'success',
      },
    ]);
  });

  it('preserves bounded inline approval metadata only on an execution result', () => {
    const approval = {
      id: 'approval-1',
      title: '결제 요약 — Slack 메시지 전송',
      reason: '외부 작업 승인 필요: slack.message.send@1',
    };
    expect(normalizeChatMessages([
      {
        role: 'assistant',
        content: '승인 대기 중입니다.',
        kind: 'execution_result',
        executionId: 'exec-1',
        executionStatus: 'pending_approval',
        approval,
      },
    ])).toEqual([{
      role: 'assistant',
      content: '승인 대기 중입니다.',
      kind: 'execution_result',
      executionId: 'exec-1',
      executionStatus: 'pending_approval',
      approval,
    }]);
    expect(() => normalizeChatMessages([
      { role: 'assistant', content: '일반 답변', approval },
    ])).toThrow();
  });
});
