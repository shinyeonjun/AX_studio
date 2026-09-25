import { describe, expect, it } from 'vitest';
import { compileCronMatcher, cronMatches } from '../runtime/scheduler.js';

describe('cron', () => {
  it('matches a friday afternoon expression', () => {
    const friday = new Date(2026, 7, 21, 17, 0, 0);
    expect(friday.getDay()).toBe(5);
    expect(cronMatches('0 17 * * 5', friday)).toBe(true);
    expect(cronMatches('0 17 * * 5', new Date(2026, 7, 21, 17, 1, 0))).toBe(false);
  });

  it('supports ranges and steps in the workflow timezone', () => {
    const atFivePmSeoul = new Date('2026-08-21T08:00:00.000Z');
    expect(cronMatches('*/15 17 * * 1-5', atFivePmSeoul, 'Asia/Seoul')).toBe(true);
    expect(cronMatches('0 17 * * 1-5', new Date('2026-08-21T08:01:00.000Z'), 'Asia/Seoul')).toBe(false);
  });

  it('treats restricted day-of-month and weekday fields as alternatives', () => {
    const friday = new Date(2026, 7, 21, 17, 0, 0);
    expect(cronMatches('0 17 20 * 5', friday)).toBe(true);
  });

  it('matches Sunday when weekday uses the 7 alias', () => {
    const sunday = new Date(2026, 7, 23, 9, 0, 0);
    expect(cronMatches('0 9 * * 7', sunday)).toBe(true);
  });

  it('reuses a compiled timezone matcher across dates and treats invalid timezones as no match', () => {
    const matchesSeoul = compileCronMatcher('0 17 * * 1-5', 'Asia/Seoul');
    expect(matchesSeoul).toBeDefined();
    expect(matchesSeoul?.(new Date('2026-08-21T08:00:00.000Z'))).toBe(true);
    expect(matchesSeoul?.(new Date('2026-08-21T08:01:00.000Z'))).toBe(false);
    expect(compileCronMatcher('0 17 * * 1-5', 'Not/A_Timezone')).toBeUndefined();
    expect(cronMatches('0 17 * * 1-5', new Date(), 'Not/A_Timezone')).toBe(false);
  });

  it('rejects impossible month/day combinations before a long catch-up scan', () => {
    expect(compileCronMatcher('0 9 31 2 *', 'UTC')).toBeUndefined();
    expect(compileCronMatcher('0 9 29 2 *', 'UTC')).toBeDefined();
    expect(cronMatches('0 9 31 2 *', new Date('2026-02-28T09:00:00.000Z'), 'UTC')).toBe(false);
  });

  it('preserves repeated and skipped local times across daylight-saving transitions', () => {
    const matchesFallBack = compileCronMatcher('30 1 * * *', 'America/New_York');
    expect(matchesFallBack?.(new Date('2026-11-01T05:30:00.000Z'))).toBe(true);
    expect(matchesFallBack?.(new Date('2026-11-01T06:30:00.000Z'))).toBe(true);
    expect(matchesFallBack?.(new Date('2026-11-01T07:30:00.000Z'))).toBe(false);

    const matchesSpringForward = compileCronMatcher('30 2 * * *', 'America/New_York');
    expect(matchesSpringForward?.(new Date('2026-03-08T07:30:00.000Z'))).toBe(false);
  });
});
