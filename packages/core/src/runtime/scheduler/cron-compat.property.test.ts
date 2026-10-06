import { describe, expect, it } from 'vitest';
import { compileCronMatcher } from './cron.js';
import { compileSchedule } from './schedule-match.js';
import { findLatestCronMatch as legacyFindLatestCronMatch } from './testing/legacy-cron.js';
import { nextCronOccurrences } from '../../workflow/schedule/cron-schedule.js';
import { describeSchedule } from '../../workflow/schedule/describe.js';
import { isValidCronExpression } from '../../workflow/cron.js';
import { mulberry32, seedList } from '../../workflow/schedule/testing/random.js';

/*
 * Backward compatibility: saved cron schedules must behave exactly as before.
 * Random valid cron strings are run through the scheduler's compiled schedule
 * and compared with a frozen copy of the pre-change matcher, over windows from
 * one minute to several years (the catch-up after the app was closed).
 */
const ZONES = ['Asia/Seoul', 'America/New_York', 'Europe/London', 'Australia/Lord_Howe', 'America/Santiago', 'Asia/Kolkata'];
const MINUTE = 60_000;
const DAY = 86_400_000;

function randomCron(random: () => number): string {
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const field = (min: number, max: number, common: string[]) => {
    const roll = random();
    if (roll < 0.25) return '*';
    if (roll < 0.45) return pick(common);
    if (roll < 0.6) return `*/${int(2, Math.max(2, Math.floor((max - min) / 2)))}`;
    if (roll < 0.75) {
      const start = int(min, max);
      return `${start}-${int(start, max)}`;
    }
    return [...new Set(Array.from({ length: int(1, 3) }, () => int(min, max)))].join(',');
  };
  const minute = random() < 0.5 ? String(pick([0, 15, 30, 45])) : field(0, 59, ['0', '30', '*/15']);
  const hour = random() < 0.5 ? String(int(0, 23)) : field(0, 23, ['9', '2', '1', '9,18', '*/6']);
  const day = random() < 0.6 ? '*' : field(1, 31, ['1', '15', '29', '31', '28-31']);
  const month = random() < 0.7 ? '*' : field(1, 12, ['2', '1,4,7,10', '12']);
  const weekday = random() < 0.6 ? '*' : field(0, 7, ['1-5', '0,6', '1', '7']);
  return `${minute} ${hour} ${day} ${month} ${weekday}`;
}

describe('legacy cron schedules keep their exact behaviour', () => {
  it.each(seedList(80))('scheduler catch-up matches the pre-change matcher (seed %i)', (seed) => {
    const random = mulberry32(seed);
    let cron = randomCron(random);
    while (!isValidCronExpression(cron)) cron = randomCron(random);
    const timezone = ZONES[Math.floor(random() * ZONES.length)]!;
    const compiled = compileSchedule({ type: 'schedule', schedule: cron, timezone });
    for (let probe = 0; probe < 8; probe += 1) {
      const span = [MINUTE, 90 * MINUTE, DAY, 40 * DAY, 800 * DAY, 5 * 365 * DAY][probe % 6]!;
      const to = Date.UTC(2025, 0, 1) + Math.floor(random() * 700 * DAY / MINUTE) * MINUTE;
      const from = to - Math.floor(random() * span / MINUTE) * MINUTE;
      const expected = legacyFindLatestCronMatch(cron, new Date(from), new Date(to), timezone)?.toISOString();
      const actual = compiled(new Date(from), new Date(to))?.toISOString();
      expect(actual, `seed=${seed} cron="${cron}" tz=${timezone} window=${new Date(from).toISOString()}..${new Date(to).toISOString()}`)
        .toBe(expected);
    }
  });

  it.each(seedList(25))('next-run preview matches a minute-by-minute cron walk (seed %i)', (seed) => {
    const random = mulberry32(seed + 5_000);
    let cron = randomCron(random);
    while (!isValidCronExpression(cron)) cron = randomCron(random);
    const timezone = ZONES[Math.floor(random() * ZONES.length)]!;
    const matcher = compileCronMatcher(cron, timezone);
    const after = Date.UTC(2025, 2, 1) + Math.floor(random() * 300 * DAY / MINUTE) * MINUTE;
    const expected: string[] = [];
    // Bounded walk: dense schedules fill quickly, sparse ones are checked within the horizon.
    for (let t = after + MINUTE; t <= after + 45 * DAY && expected.length < 3 && matcher; t += MINUTE) {
      if (matcher(new Date(t))) expected.push(new Date(t).toISOString());
    }
    const actual = nextCronOccurrences(cron, timezone, new Date(after), 3)
      .map((date) => date.toISOString())
      .filter((value) => Date.parse(value) <= after + 45 * DAY);
    expect(actual, `seed=${seed} cron="${cron}" tz=${timezone} after=${new Date(after).toISOString()}`).toEqual(expected);
  });

  it.each(seedList(80))('describes a cron in plain Korean without cron text (seed %i)', (seed) => {
    const random = mulberry32(seed + 9_000);
    let cron = randomCron(random);
    while (!isValidCronExpression(cron)) cron = randomCron(random);
    const text = describeSchedule({ schedule: cron, timezone: 'Asia/Seoul' });
    expect(text.length, cron).toBeGreaterThan(0);
    expect(text, cron).not.toMatch(/\*|cron|\/\d|\d+-\d+ \*/u);
    expect(text, cron).not.toContain(cron);
  });
});
