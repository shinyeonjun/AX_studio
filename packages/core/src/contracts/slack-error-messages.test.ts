import { describe, expect, it } from 'vitest';
import { slackErrorMessage } from './error-messages.js';

describe('Slack errors said as what to do', () => {
  it('translates Slack codes, keeps Korean, and never shows raw English', () => {
    expect(slackErrorMessage('An API error occurred: invalid_auth')).toContain('토큰이 올바르지 않아요');
    expect(slackErrorMessage('token_revoked')).toContain('다시 설치');
    expect(slackErrorMessage('Slack 봇 토큰이 필요합니다.')).toBe('Slack 봇 토큰이 필요합니다.');
    expect(slackErrorMessage('socket hang up')).toBe('Slack에 연결하지 못했어요. 토큰과 인터넷 연결을 확인해 주세요.');
    expect(slackErrorMessage(undefined)).toBeUndefined();
  });
});
