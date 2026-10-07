import { describe, expect, it } from 'vitest';
import { explicitSlackChannel } from './read-operation-catalog.js';

describe('the Slack channel a request names', () => {
  it.each([
    ['#ops 채널 최근 메시지 보여줘', '#ops'],
    ['운영팀 채널에 어제 올라온 글', '#운영팀'],
    ['(#일반) 최근 5개', '#일반'],
    ['Slack 채널 목록 보여줘', undefined],
    ['슬랙 채널 최근 메시지', undefined],
    ['최근 메시지 보여줘', undefined],
  ])('%s -> %s', (message, expected) => {
    expect(explicitSlackChannel(message)).toBe(expected);
  });
});
