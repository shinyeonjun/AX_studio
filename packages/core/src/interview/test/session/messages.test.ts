import { describe, expect, it } from 'vitest';
import { buildAssistantMessage } from '../../session/messages.js';
import type { CompletenessResult } from '../../slots/types.js';

describe('buildAssistantMessage', () => {
  it('shows the AI interview question when values are missing', () => {
    const completeness: CompletenessResult = {
      slots: [
        { slot: 'trigger', filled: true, label: '시작', question: '언제 실행할까요?' },
        { slot: 'a.params.channel', filled: false, label: 'Slack', question: 'Slack 채널은?' },
      ],
      missingRequired: ['a.params.channel'],
      deployable: false,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('critical일 때 알릴 Slack 채널을 알려주세요.', completeness, false, 'once');

    expect(text).toBe('critical일 때 알릴 Slack 채널을 알려주세요.');
    expect(text).not.toMatch(/^\d+\./m);
    expect(text).not.toContain('오른쪽 패널에서 채워');
  });

  it('asks trigger questions in chat for recurring scope', () => {
    const completeness: CompletenessResult = {
      slots: [{ slot: 'trigger', filled: false, label: '시작', question: '언제 실행할까요?' }],
      missingRequired: ['trigger'],
      deployable: false,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('', completeness, false, 'recurring');

    expect(text).toBe('언제 실행할까요?');
    expect(text).not.toContain('시작 노드');
  });

  it('uses deployable confirmation text without rewriting nextQuestion', () => {
    const completeness: CompletenessResult = {
      slots: [],
      missingRequired: [],
      deployable: true,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('Slack 채널을 알려주세요?', completeness, true, 'once');

    expect(text).toBe('Slack 채널을 알려주세요?');
  });
});
