import { describe, expect, it } from 'vitest';
import { localDateTime, slackLocalTime } from './local-time.js';

describe('local time for read results', () => {
  it('writes a time as local "YYYY-MM-DD HH:mm"', () => {
    expect(localDateTime(new Date(2026, 9, 8, 9, 5))).toBe('2026-10-08 09:05');
    expect(localDateTime(new Date('not a date'))).toBeUndefined();
  });

  it('reads a Slack message timestamp as seconds', () => {
    const ts = String(new Date(2026, 9, 8, 14, 30).getTime() / 1000) + '.000200';
    expect(slackLocalTime(ts)).toBe('2026-10-08 14:30');
    expect(slackLocalTime('abc')).toBeUndefined();
  });
});
