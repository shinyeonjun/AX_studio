import { describe, expect, it } from 'vitest';
import { INTERVIEW_RECENT_MESSAGE_COUNT, formatWorkflowState, windowInterviewMessages } from './prompt-context.js';

describe('prompt-context', () => {
  it('formats workflow state compactly without pretty JSON', () => {
    const text = formatWorkflowState({
      name: '테스트',
      goal: '메일 보내기',
      triggerType: 'once',
      runAt: '2026-08-19T10:00:00.000Z',
      assumptions: ['기본 제목'],
      nodes: [
        {
          type: 'action',
          id: 'send',
          connector: 'gmail',
          action: 'message.send',
          params: { to: 'a@b.com' },
        },
      ],
    });
    expect(text).toContain('trigger: once runAt=');
    expect(text).toContain('- action send: gmail.message.send');
    expect(text).not.toContain('"nodes"');
  });

  it('windows long chat history with a summary prefix', () => {
    const messages = Array.from({ length: INTERVIEW_RECENT_MESSAGE_COUNT + 3 }, (_, index) => ({
      role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `message-${index}`,
    }));
    const windowed = windowInterviewMessages(messages);
    expect(windowed).toHaveLength(INTERVIEW_RECENT_MESSAGE_COUNT + 1);
    expect(windowed[0]?.content).toContain('[이전 대화 요약]');
    expect(windowed.at(-1)?.content).toBe(`message-${messages.length - 1}`);
  });
});
