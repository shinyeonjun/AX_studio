import { describe, expect, it } from 'vitest';
import { contextUpdateConfirmation } from './helpers.js';

describe('contextUpdateConfirmation', () => {
  it('returns only the exact proposal attached to the selected confirmation action', () => {
    const proposal = {
      scope: 'session' as const,
      key: 'user_rule_1',
      value: '답변은 한국어로 짧게',
    };
    const messages = [
      {
        role: 'assistant' as const,
        content: '이 내용을 기억할까요?',
        presentations: [{
          title: '이 내용을 기억할까요?',
          inputMode: 'individual' as const,
          blocks: [{ type: 'note' as const, text: proposal.value }],
          inputs: [],
          actions: [{
            id: 'remember-session',
            label: '이 대화에 저장',
            value: '이 대화에 user_rule_1 규칙으로 저장해줘',
            tone: 'primary' as const,
            purpose: 'confirm_context' as const,
            contextUpdate: proposal,
          }],
        }],
      },
      { role: 'user' as const, content: '이 대화에 user_rule_1 규칙으로 저장해줘' },
    ];

    expect(contextUpdateConfirmation(messages, messages[1]!.content)).toEqual(proposal);
    expect(contextUpdateConfirmation(messages, '이 workflow에 user_rule_1 규칙으로 저장해줘')).toBeUndefined();
  });

  it('does not treat legacy confirmation cards without a bound payload as authorization', () => {
    const messages = [
      {
        role: 'assistant' as const,
        content: '저장할까요?',
        presentations: [{
          title: '저장할까요?',
          inputMode: 'individual' as const,
          blocks: [{ type: 'note' as const, text: '사용자가 확인하지 않은 값' }],
          inputs: [],
          actions: [{
            id: 'remember',
            label: '기억하기',
            value: '저장해줘',
            tone: 'secondary' as const,
            purpose: 'confirm_context' as const,
          }],
        }],
      },
      { role: 'user' as const, content: '저장해줘' },
    ];

    expect(contextUpdateConfirmation(messages, '저장해줘')).toBeUndefined();
  });
});
