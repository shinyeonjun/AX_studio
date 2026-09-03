import { describe, expect, it } from 'vitest';
import { cronMatches } from '../runtime/scheduler.js';

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
});
