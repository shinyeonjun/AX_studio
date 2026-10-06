import { describe, expect, it } from 'vitest';
import { findLatestOccurrence, nextOccurrences, validateRecurrence } from './occurrences.js';
import type { Recurrence } from './recurrence.js';
import { findLatestCronMatch } from '../../runtime/scheduler/cron.js';

const base = { kind: 'recurrence' as const, interval: 1, anchor: '2026-01-01', timezone: 'America/New_York' };
const iso = (dates: Date[]) => dates.map((date) => date.toISOString());

describe('documented edge rules', () => {
  it('runs a skipped local time once, when the clock jumps forward', () => {
    // 2026-03-08: New York jumps 02:00 → 03:00; 02:30 and 02:45 both run at 03:00 EDT.
    const rule: Recurrence = { ...base, freq: 'daily', times: [{ hour: 2, minute: 30 }, { hour: 2, minute: 45 }] };
    expect(iso(nextOccurrences(rule, new Date('2026-03-07T12:00:00Z'), 3)))
      .toEqual(['2026-03-08T07:00:00.000Z', '2026-03-09T06:30:00.000Z', '2026-03-09T06:45:00.000Z']);
  });

  it('runs a repeated local time once, at its first occurrence', () => {
    // 2026-11-01: New York repeats 01:00–01:59.
    const rule: Recurrence = { ...base, freq: 'daily', times: [{ hour: 1, minute: 30 }] };
    expect(iso(nextOccurrences(rule, new Date('2026-11-01T00:00:00Z'), 2)))
      .toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z']);
  });

  it('skips months without day 31, handles Feb 29 and negative days', () => {
    const at = (rule: Partial<Recurrence>, count: number) => iso(nextOccurrences(
      { ...base, timezone: 'UTC', times: [{ hour: 0, minute: 0 }], ...rule } as Recurrence, new Date('2027-12-31T00:00:00Z'), count,
    )).map((value) => value.slice(0, 10));
    expect(at({ freq: 'monthly', byMonthDay: [31] }, 3)).toEqual(['2028-01-31', '2028-03-31', '2028-05-31']);
    expect(at({ freq: 'monthly', byMonthDay: [-1] }, 3)).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
    expect(at({ freq: 'yearly', byMonth: [2], byMonthDay: [29] }, 2)).toEqual(['2028-02-29', '2032-02-29']);
    expect(at({ freq: 'monthly', byWeekday: [{ day: 'FR', nth: -1 }] }, 2)).toEqual(['2028-01-28', '2028-02-25']);
  });
});

describe('validateRecurrence', () => {
  it.each<[string, Partial<Recurrence>]>([
    ['nth on a weekly rule', { freq: 'weekly', byWeekday: [{ day: 'MO', nth: 1 }], times: [{ hour: 9, minute: 0 }] }],
    ['weekly without days', { freq: 'weekly', times: [{ hour: 9, minute: 0 }] }],
    ['daily without times', { freq: 'daily' }],
    ['minutely with times', { freq: 'minutely', times: [{ hour: 9, minute: 0 }] }],
    ['monthly with two day rules', { freq: 'monthly', byMonthDay: [1], byWeekday: [{ day: 'MO', nth: 1 }], times: [{ hour: 9, minute: 0 }] }],
    ['monthly weekday without nth', { freq: 'monthly', byWeekday: [{ day: 'MO' }], times: [{ hour: 9, minute: 0 }] }],
    ['yearly without month', { freq: 'yearly', byMonthDay: [1], times: [{ hour: 9, minute: 0 }] }],
    ['a date that never exists', { freq: 'yearly', byMonth: [2], byMonthDay: [30], times: [{ hour: 9, minute: 0 }] }],
    ['an unknown time zone', { freq: 'daily', times: [{ hour: 9, minute: 0 }], timezone: 'Mars/Base' }],
    ['until before anchor', { freq: 'daily', times: [{ hour: 9, minute: 0 }], until: '2025-12-31' }],
    ['interval too long', { freq: 'yearly', interval: 11, byMonth: [1], byMonthDay: [1], times: [{ hour: 9, minute: 0 }] }],
    ['duplicate times', { freq: 'daily', times: [{ hour: 9, minute: 0 }, { hour: 9, minute: 0 }] }],
  ])('rejects %s', (_label, rule) => {
    expect(validateRecurrence({ ...base, ...rule }).ok).toBe(false);
  });

  it('rejects malformed shapes', () => {
    expect(validateRecurrence({ ...base, freq: 'daily', times: [{ hour: 24, minute: 0 }] }).ok).toBe(false);
    expect(validateRecurrence({ ...base, freq: 'daily', times: [{ hour: 9, minute: 0 }], anchor: '2026-02-30' }).ok).toBe(false);
    expect(validateRecurrence({ ...base, freq: 'daily', times: [{ hour: 9, minute: 0 }], extra: true }).ok).toBe(false);
  });
});

describe('performance budget', () => {
  it('answers 10k next-run queries and a 5-year catch-up quickly', () => {
    const rules: Recurrence[] = [
      { ...base, freq: 'weekly', interval: 2, byWeekday: [{ day: 'WE' }], times: [{ hour: 10, minute: 0 }] },
      { ...base, freq: 'monthly', byWeekday: [{ day: 'MO', nth: 1 }], times: [{ hour: 9, minute: 0 }, { hour: 18, minute: 30 }] },
      { ...base, freq: 'daily', weekdaysOnly: true, times: [{ hour: 9, minute: 0 }] },
      { ...base, freq: 'minutely', interval: 15 },
      { ...base, freq: 'yearly', byMonth: [2], byMonthDay: [29], times: [{ hour: 9, minute: 0 }] },
    ];
    const started = performance.now();
    for (let query = 0; query < 10_000; query += 1) {
      const rule = rules[query % rules.length]!;
      nextOccurrences(rule, new Date(Date.UTC(2026, 0, 1) + query * 3_600_000), 3);
    }
    const queries = performance.now() - started;

    const catchUpStart = performance.now();
    const from = new Date('2021-01-01T00:00:00Z');
    const to = new Date('2026-01-01T00:00:00Z');
    for (const rule of rules) findLatestOccurrence({ ...rule, anchor: '2020-01-01' }, from, to);
    for (const cron of ['0 9 * * 1-5', '0 9 29 2 *', '*/5 * * * *', '0 9 1 1 *']) findLatestCronMatch(cron, from, to, 'America/New_York');
    const catchUp = performance.now() - catchUpStart;

    // ~0.25 s on its own; the budget leaves room for a loaded CI runner and still fails on a
    // complexity regression (a per-minute scan or quadratic catch-up is orders of magnitude slower).
    expect(queries, `10k queries took ${queries.toFixed(0)}ms`).toBeLessThan(4_000);
    expect(catchUp, `5-year catch-up took ${catchUp.toFixed(0)}ms`).toBeLessThan(4_000);
  });
});

describe('skipping public holidays', () => {
  const seoul = { kind: 'recurrence' as const, interval: 1, anchor: '2026-09-01', timezone: 'Asia/Seoul', skipHolidays: 'KR' as const };
  const localDates = (dates: Date[]) => dates.map((date) => new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10));

  it('skips 추석 and 개천절 substitute days for a weekday rule', () => {
    const rule: Recurrence = { ...seoul, freq: 'daily', weekdaysOnly: true, times: [{ hour: 9, minute: 0 }] };
    // 9/24-26 추석, 10/5 개천절 대체공휴일.
    expect(localDates(nextOccurrences(rule, new Date('2026-09-21T12:00:00Z'), 6)))
      .toEqual(['2026-09-22', '2026-09-23', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01']);
    expect(localDates(nextOccurrences(rule, new Date('2026-10-01T03:00:00Z'), 2))).toEqual(['2026-10-02', '2026-10-06']);
  });

  it('skips 신정 for "1st of every month" and catches up to the last real run', () => {
    const rule: Recurrence = { ...seoul, freq: 'monthly', byMonthDay: [1], times: [{ hour: 9, minute: 0 }] };
    expect(localDates(nextOccurrences(rule, new Date('2026-11-15T00:00:00Z'), 2))).toEqual(['2026-12-01', '2027-02-01']);
    expect(findLatestOccurrence(rule, new Date('2026-12-15T00:00:00Z'), new Date('2027-01-20T00:00:00Z'))).toBeUndefined();
  });

  it('skips holiday hours of an hourly rule', () => {
    const rule: Recurrence = { ...seoul, freq: 'hourly', interval: 6 };
    const days = new Set(localDates(nextOccurrences(rule, new Date('2026-09-23T00:00:00Z'), 12)));
    for (const holiday of ['2026-09-24', '2026-09-25', '2026-09-26']) expect(days.has(holiday)).toBe(false);
  });
});
