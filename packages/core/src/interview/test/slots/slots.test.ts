import { describe, expect, it } from 'vitest';
import { isActionParamFilled } from '../../slots/filled.js';
import { nodeParamSlotId, parseNodeParamSlot } from '../../slots/ids.js';
import { assessCompleteness } from '../../slots/requiredness.js';

describe('interview-slots', () => {
  it('builds node param slot ids', () => {
    expect(nodeParamSlotId('critical_slack', 'channel')).toBe('critical_slack.params.channel');
    expect(parseNodeParamSlot('critical_slack.params.channel')).toEqual({
      nodeId: 'critical_slack',
      paramName: 'channel',
    });
  });

  it('treats refs and non-empty strings as filled', () => {
    expect(isActionParamFilled('')).toBe(false);
    expect(isActionParamFilled('#ops')).toBe(true);
    expect(isActionParamFilled({ ref: 'classify.message' })).toBe(true);
    expect(isActionParamFilled('{{filePath}}')).toBe(true);
  });

  it('tracks separate required slots per action node', () => {
    const missing = assessCompleteness(
      {
        goal: '위험도별 Slack',
        success: '완료',
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'action',
            id: 'critical_slack',
            connector: 'slack',
            action: 'message.send',
            params: {},
            sideEffect: 'EXTERNAL',
          },
          {
            type: 'action',
            id: 'high_slack',
            connector: 'slack',
            action: 'message.send',
            params: {},
            sideEffect: 'EXTERNAL',
          },
        ],
      },
      ['slack'],
    );

    expect(missing.missingRequired).toContain('critical_slack.params.channel');
    expect(missing.missingRequired).toContain('high_slack.params.channel');
    const criticalQuestion = missing.slots.find((slot) => slot.slot === 'critical_slack.params.channel')?.question;
    expect(criticalQuestion).toBe('긴급(critical) 알림을 보낼 Slack 채널은 어디인가요?');
    expect(criticalQuestion).not.toContain('critical_slack');
  });

  it('does not require bound text params', () => {
    const result = assessCompleteness(
      {
        goal: '알림',
        success: '완료',
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'ai_decision',
            id: 'classify',
            goal: '위험도 분류',
            outputSchema: {
              type: 'object',
              properties: { summary: { type: 'string', description: '요약' } },
              required: ['summary'],
            },
          },
          {
            type: 'action',
            id: 'critical_slack',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#ax테스트' },
            bindings: { text: { from: 'classify', output: 'summary' } },
            sideEffect: 'EXTERNAL',
          },
        ],
      },
      ['slack'],
    );

    expect(result.missingRequired).not.toContain('critical_slack.params.text');
  });

  it('requires gmail send body before deployable', () => {
    const result = assessCompleteness(
      {
        goal: '테스트 메일',
        success: '완료',
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'action',
            id: 'send_mail',
            connector: 'gmail',
            action: 'message.send',
            params: { to: 'plosind@naver.com', subject: '테스트' },
            sideEffect: 'EXTERNAL_HIGH',
          },
        ],
      },
      ['gmail'],
    );

    expect(result.deployable).toBe(false);
    expect(result.missingRequired).toContain('send_mail.params.body');
  });
});
