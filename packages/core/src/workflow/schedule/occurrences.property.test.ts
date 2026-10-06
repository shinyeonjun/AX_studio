import { describe, expect, it } from 'vitest';
import { findLatestOccurrence, nextOccurrences, validateRecurrence } from './occurrences.js';
import { recurrenceShapeIssues, WEEKDAY_CODES, type Recurrence } from './recurrence.js';
import { referenceOccurrences } from './testing/reference.js';
import { mulberry32, seedList } from './testing/random.js';

/*
 * Property test: the engine must agree with an independent minute-walking
 * reference for random rules. Seeds are fixed (CI is reproducible); each test
 * title carries its seed and failures print the rule. Set AX_SCHEDULE_SEEDS=n
 * to run more seeds locally.
 */
const ZONES = [
  'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'America/Santiago',
  'America/Havana', 'Asia/Seoul', 'Pacific/Chatham', 'Asia/Kolkata',
];
const DST_ZONES = ['America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'America/Santiago', 'America/Havana', 'Pacific/Chatham'];
const DAY = 86_400_000;

function iso(dayNo: number): string {
  return new Date(dayNo * DAY).toISOString().slice(0, 10);
}

function randomRule(random: () => number, dstFocus = false): Recurrence {
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const sample = <T>(values: readonly T[], size: number): T[] => {
    const pool = [...values];
    const out: T[] = [];
    while (out.length < size && pool.length) out.push(pool.splice(Math.floor(random() * pool.length), 1)[0]!);
    return out;
  };
  // Bias toward DST-sensitive clock times and month ends.
  const time = () => dstFocus
    ? { hour: int(0, 3), minute: pick([0, 15, 30, 45]) }
    : random() < 0.4
    ? pick([{ hour: 0, minute: 0 }, { hour: 0, minute: 30 }, { hour: 1, minute: 30 }, { hour: 2, minute: 0 }, { hour: 2, minute: 30 }, { hour: 23, minute: 30 }, { hour: 3, minute: 0 }])
    : { hour: int(0, 23), minute: pick([0, 15, 30, 45, int(0, 59)]) };
  const times = () => [...new Map(Array.from({ length: int(1, 3) }, time).map((t) => [`${t.hour}:${t.minute}`, t])).values()];
  const anchorDay = int(Date.UTC(2024, 5, 1) / DAY, Date.UTC(2026, 5, 1) / DAY);
  const base = {
    kind: 'recurrence' as const,
    anchor: iso(anchorDay),
    timezone: pick(dstFocus ? DST_ZONES : ZONES),
    ...(random() < 0.15 ? { until: iso(anchorDay + int(20, 700)) } : {}),
    ...(random() < 0.25 ? { skipHolidays: 'KR' as const } : {}),
  };
  const freq = dstFocus ? pick(['daily', 'weekly', 'monthly'] as const) : pick(['minutely', 'hourly', 'daily', 'daily', 'weekly', 'weekly', 'monthly', 'monthly', 'monthly', 'yearly'] as const);
  const monthDays = () => sample([1, 2, 15, 28, 29, 30, 31, -1, -2, -3, int(1, 31)], int(1, 2));
  const nthDays = () => sample(WEEKDAY_CODES, int(1, 2)).map((day) => ({ day, nth: pick([1, 2, 3, 4, 5, -1, -2]) }));
  switch (freq) {
    case 'minutely':
      return { ...base, freq, interval: pick([1, 5, 7, 15, 30, 45, 90]), ...(random() < 0.3 ? { weekdaysOnly: true } : {}) };
    case 'hourly':
      return { ...base, freq, interval: pick([1, 2, 3, 5, 6, 12, 25]), ...(random() < 0.3 ? { weekdaysOnly: true } : {}) };
    case 'daily':
      return { ...base, freq, interval: pick([1, 1, 2, 3, 10]), times: times(), ...(random() < 0.3 ? { weekdaysOnly: true } : {}) };
    case 'weekly':
      return { ...base, freq, interval: pick([1, 2, 2, 3, 4]), times: times(), byWeekday: sample(WEEKDAY_CODES, int(1, 4)).map((day) => ({ day })) };
    case 'monthly': {
      const byNth = random() < 0.4;
      return {
        ...base, freq, interval: pick([1, 1, 2, 3, 6, 12]), times: times(),
        ...(byNth ? { byWeekday: nthDays() } : { byMonthDay: monthDays(), ...(random() < 0.2 ? { weekdaysOnly: true } : {}) }),
        ...(random() < 0.2 ? { byMonth: sample([1, 2, 3, 4, 6, 9, 12], int(1, 3)) } : {}),
      };
    }
    case 'yearly': {
      const byNth = random() < 0.3;
      return {
        ...base, freq, interval: pick([1, 1, 2]), times: times(), byMonth: sample([1, 2, 2, 3, 10, 11, 12], int(1, 2)).filter((m, i, all) => all.indexOf(m) === i),
        ...(byNth ? { byWeekday: nthDays() } : { byMonthDay: sample([1, 29, 30, 31, -1, int(1, 28)], int(1, 2)) }),
      };
    }
  }
}

function windowFor(rule: Recurrence, random: () => number): { start: number; end: number } {
  const start = Date.UTC(2025, 0, 1) + Math.floor(random() * 500 * DAY / 60_000) * 60_000;
  const span = rule.freq === 'minutely' ? 6 * DAY : rule.freq === 'hourly' ? 90 * DAY : 730 * DAY;
  return { start, end: start + span };
}

const isoList = (values: readonly number[]) => values.map((value) => new Date(value).toISOString());

function checkAgainstReference(seed: number, dstFocus: boolean): void {
    const random = mulberry32(seed);
    let rule = randomRule(random, dstFocus);
    while (recurrenceShapeIssues(rule).length > 0) rule = randomRule(random, dstFocus);
    const { start, end } = windowFor(rule, random);
    const context = `seed=${seed} rule=${JSON.stringify(rule)} window=${new Date(start).toISOString()}..${new Date(end).toISOString()}`;

    const expected = referenceOccurrences(rule, start, end);
    const actual = nextOccurrences(rule, new Date(start - 1), expected.length + 1)
      .map((date) => date.getTime())
      .filter((instant) => instant <= end);
    expect(isoList(actual), context).toEqual(isoList(expected));

    // Catch-up queries over random sub-windows return the newest due occurrence.
    for (let probe = 0; probe < 6; probe += 1) {
      const a = start + Math.floor(random() * (end - start) / 60_000) * 60_000;
      const b = a + Math.floor(random() * (end - a) / 60_000) * 60_000;
      const inside = expected.filter((instant) => instant >= a && instant <= b);
      const latest = findLatestOccurrence(rule, new Date(a), new Date(b))?.getTime();
      expect(latest === undefined ? undefined : new Date(latest).toISOString(), `${context} probe=${new Date(a).toISOString()}..${new Date(b).toISOString()}`)
        .toEqual(inside.length ? new Date(inside.at(-1)!).toISOString() : undefined);
    }

    // A shape-valid rule is valid exactly when it can run at all.
    const firstEver = nextOccurrences(rule, new Date(Date.parse(rule.anchor) - 2 * DAY), 1);
    expect(validateRecurrence(rule).ok, context).toBe(firstEver.length > 0);
}

describe('recurrence engine vs brute-force reference', () => {
  it.each(seedList(60))('agrees on random rules (seed %i)', (seed) => checkAgainstReference(seed, false));
  // Night-time clock times in DST zones: repeated and skipped local times on every transition.
  it.each(seedList(30).map((seed) => seed + 10_000))('agrees around DST transitions (seed %i)', (seed) => checkAgainstReference(seed, true));
});
