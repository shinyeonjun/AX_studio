import { describe, expect, it } from 'vitest';
import { compileCronMatcher, findLatestCronMatch } from './cron.js';

function bruteForceLatest(
  expression: string,
  from: Date,
  to: Date,
  timeZone?: string,
): Date | undefined {
  const matches = compileCronMatcher(expression, timeZone);
  if (!matches) return undefined;
  for (let timestamp = to.getTime(); timestamp >= from.getTime(); timestamp -= 60_000) {
    const candidate = new Date(timestamp);
    if (matches(candidate)) return candidate;
  }
  return undefined;
}

describe('findLatestCronMatch', () => {
  it('finds sparse annual schedules without scanning every minute', () => {
    const from = new Date('2025-09-25T00:00:00.000Z');
    const to = new Date('2026-09-25T00:00:00.000Z');

    expect(findLatestCronMatch('0 9 1 1 *', from, to, 'Asia/Seoul'))
      .toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });

  it('matches the latest occurrence across a repeated DST hour', () => {
    const from = new Date('2026-10-25T00:00:00.000Z');
    const to = new Date('2026-10-25T01:45:00.000Z');

    expect(findLatestCronMatch('30 2 * * *', from, to, 'Europe/Berlin'))
      .toEqual(new Date('2026-10-25T01:30:00.000Z'));
  });

  it('skips nonexistent local times at a DST gap', () => {
    const from = new Date('2026-03-29T00:00:00.000Z');
    const to = new Date('2026-03-29T01:45:00.000Z');

    expect(findLatestCronMatch('30 2 * * *', from, to, 'Europe/Berlin')).toBeUndefined();
  });

  it('does not invent an occurrence on a skipped date-line day', () => {
    const from = new Date('2011-12-29T00:00:00.000Z');
    const to = new Date('2011-12-31T12:00:00.000Z');

    expect(findLatestCronMatch('0 9 30 12 *', from, to, 'Pacific/Apia')).toBeUndefined();
  });

  it.each([
    ['*/7 1-3 * * 0-6', '2026-03-28T00:00:00.000Z', '2026-03-30T00:00:00.000Z', 'Europe/Berlin'],
    ['15,45 2 * * *', '2026-10-24T00:00:00.000Z', '2026-10-26T00:00:00.000Z', 'Europe/Berlin'],
    ['0 9 1 * 1', '2026-03-27T00:00:00.000Z', '2026-03-31T00:00:00.000Z', 'Europe/Berlin'],
    ['*/13 1-3 * * *', '2026-10-01T00:00:00.000Z', '2026-10-10T00:00:00.000Z', 'Australia/Lord_Howe'],
    ['0 9 * * *', '2011-12-29T00:00:00.000Z', '2012-01-01T00:00:00.000Z', 'Pacific/Apia'],
  ])('agrees with the minute matcher for %s in %s', (expression, fromText, toText, timeZone) => {
    const from = new Date(fromText);
    const to = new Date(toText);
    expect(findLatestCronMatch(expression, from, to, timeZone))
      .toEqual(bruteForceLatest(expression, from, to, timeZone));
  });
});
