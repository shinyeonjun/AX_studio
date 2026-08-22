import { describe, expect, it } from 'vitest';
import { nodeRoleHint, nodeSlotLabel, nodeSlotQuestion } from '../../slots/ids.js';

describe('node slot copy', () => {
  it('does not expose raw node ids in chat questions', () => {
    expect(nodeSlotQuestion('classify_risk', '이 AI 단계는 무엇을 판단하거나 분류할까요?')).toBe(
      '이 AI 단계는 무엇을 판단하거나 분류할까요?',
    );
    expect(nodeSlotQuestion('critical_slack', 'Slack 채널은 어디인가요?')).toBe(
      '긴급(critical) 알림을 보낼 Slack 채널은 어디인가요?',
    );
    expect(nodeSlotQuestion('high_slack', 'Slack 채널은 어디인가요?')).toBe(
      '운영(high) 알림을 보낼 Slack 채널은 어디인가요?',
    );
  });

  it('uses branch hints in labels without node ids', () => {
    expect(nodeRoleHint('critical_slack')).toBe('긴급(critical)');
    expect(nodeSlotLabel('critical_slack', 'Slack 채널')).toBe('긴급(critical) · Slack 채널');
    expect(nodeSlotLabel('notify', 'Slack 채널')).toBe('Slack 채널');
  });
});
