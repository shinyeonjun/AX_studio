import { describe, expect, it } from 'vitest';
import { planToInterviewDraft } from '../../plan/schema.js';
import { applySlotValuesToDraft } from '../../slots/patch.js';
import { isActionParamFilled } from '../../slots/filled.js';
import { nodeParamSlotId, parseNodeParamSlot } from '../../slots/ids.js';
import { ensureRequiredParamKeysOnDraft } from '../../slots/seed.js';
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
  });

  it('patches node slots independently', () => {
    const draft = planToInterviewDraft(
      {
        name: 'Slack 분기',
        goal: '위험도별 Slack',
        triggerType: 'manual',
        nodes: [
          {
            type: 'action',
            id: 'critical_slack',
            actionRef: 'slack.message.send@1',
            params: {},
          },
          {
            type: 'action',
            id: 'high_slack',
            actionRef: 'slack.message.send@1',
            params: {},
          },
        ],
      },
      {},
      '위험도별 Slack',
    );

    const patched = applySlotValuesToDraft(draft, {
      'critical_slack.params.channel': '#ax테스트',
      'high_slack.params.channel': '#ax테스트2',
    });

    expect(patched.actions.critical_slack?.params).toEqual({
      channel: '#ax테스트',
    });
    expect(patched.actions.high_slack?.params).toEqual({
      channel: '#ax테스트2',
    });
  });

  it('seeds empty required params from catalog', () => {
    const draft = planToInterviewDraft(
      {
        name: 'Slack',
        goal: '알림',
        triggerType: 'manual',
        nodes: [
          {
            type: 'action',
            id: 'notify',
            actionRef: 'slack.message.send@1',
            params: {},
          },
        ],
      },
      {},
      '알림',
    );

    const seeded = ensureRequiredParamKeysOnDraft(draft);
    expect(seeded.actions.notify?.params).toEqual({ channel: '', text: '' });
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
