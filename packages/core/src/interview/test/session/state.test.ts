import { describe, expect, it } from 'vitest';
import { createInterviewState, hydrateInterviewState } from '../../session/state.js';

describe('interview state hydration', () => {
  it('removes persisted internal agent diagnostics from the user conversation', () => {
    const state = createInterviewState('PDF를 요약해줘', 'once');
    const hydrated = hydrateInterviewState({
      ...state,
      messages: [
        ...state.messages,
        { role: 'assistant', content: '[interview_discover_1] provider=codex-cli promptChars=1200' },
        { role: 'assistant', content: '어느 채널로 보낼까요?' },
      ],
    });

    expect(hydrated.messages.map((message) => message.content)).toEqual([
      'PDF를 요약해줘',
      '어느 채널로 보낼까요?',
    ]);
  });
});
