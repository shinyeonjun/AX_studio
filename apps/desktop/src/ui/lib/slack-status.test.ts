import { describe, expect, it } from 'vitest';
import { slackCapabilityStatus } from './slack-status';

describe('Slack capability status', () => {
  it('surfaces a persisted credential recovery error while disconnected', () => {
    const status = slackCapabilityStatus({
      slackLastError: '저장된 Slack 인증 정보를 읽을 수 없습니다. 다시 연결해 주세요.',
    } as never);

    expect(status.badge).toBe('미연결');
    expect(status.detail).toBe('저장된 Slack 인증 정보를 읽을 수 없습니다. 다시 연결해 주세요.');
  });
});
