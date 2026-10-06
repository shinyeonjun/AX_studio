import { isKoreanPublicHoliday } from '../holidays-kr.js';
/*
 * Independent brute-force reference for recurrence rules (tests only). It walks
 * every UTC minute of a window, reads the local wall clock, and decides with
 * plain calendar predicates — no period arithmetic shared with the engine.
 *
 * Documented semantics it encodes:
 * - a repeated local time (clocks fall back) runs once, at its first instant;
 * - a skipped local time (clocks jump forward) runs at the first instant after
 *   the jump; several skipped times collapse into one run.
 */
import type { Recurrence } from '../recurrence.js';

const MINUTE = 60_000;
const QUARTER = 15 * MINUTE;
const DAY = 86_400_000;
const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const offsetTables = new Map<string, Map<number, number>>();
const formatters = new Map<string, Intl.DateTimeFormat>();

/** UTC offset per quarter hour, computed directly from Intl (cached per zone and window). */
function offsetFor(timeZone: string, instant: number): number {
  let table = offsetTables.get(timeZone);
  if (!table) {
    table = new Map();
    offsetTables.set(timeZone, table);
  }
  const bucket = Math.floor(instant / QUARTER) * QUARTER;
  let offset = table.get(bucket);
  if (offset === undefined) {
    let formatter = formatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      });
      formatters.set(timeZone, formatter);
    }
    const parts = formatter.formatToParts(new Date(bucket));
    const get = (type: string) => Number(parts.find((part) => part.type === type)!.value);
    offset = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - bucket;
    table.set(bucket, offset);
  }
  return offset;
}

function isoToDay(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY;
}

function dateMatches(rule: Recurrence, dayNo: number): boolean {
  const anchorDay = isoToDay(rule.anchor);
  if (dayNo < anchorDay) return false;
  if (rule.until && dayNo > isoToDay(rule.until)) return false;
  const date = new Date(dayNo * DAY);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const dow = date.getUTCDay();
  const anchor = new Date(anchorDay * DAY);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (rule.weekdaysOnly && (dow === 0 || dow === 6)) return false;
  // The holiday set has its own tests; the reference checks how skipping interacts with the walk.
  if (rule.skipHolidays && isKoreanPublicHoliday(dayNo)) return false;
  if (rule.byMonth && !rule.byMonth.includes(month)) return false;
  const dayRule = (): boolean => {
    if (rule.byMonthDay) return rule.byMonthDay.some((value) => (value > 0 ? value === day : lastDay + 1 + value === day));
    if (rule.byWeekday) {
      return rule.byWeekday.some(({ day: code, nth }) => {
        if (CODES[dow] !== code) return false;
        if (nth === undefined) return true;
        return nth > 0 ? Math.ceil(day / 7) === nth : Math.ceil((lastDay - day + 1) / 7) === -nth;
      });
    }
    return true;
  };
  switch (rule.freq) {
    case 'daily':
      return (dayNo - anchorDay) % rule.interval === 0;
    case 'weekly': {
      const monday = dayNo - ((dow + 6) % 7);
      const anchorMonday = anchorDay - ((anchor.getUTCDay() + 6) % 7);
      return ((monday - anchorMonday) / 7) % rule.interval === 0 && dayRule();
    }
    case 'monthly':
      return ((year * 12 + month) - (anchor.getUTCFullYear() * 12 + anchor.getUTCMonth() + 1)) % rule.interval === 0 && dayRule();
    case 'yearly':
      return (year - anchor.getUTCFullYear()) % rule.interval === 0 && dayRule();
    default:
      return false;
  }
}

/** All occurrences in [start, end] by walking every minute. */
export function referenceOccurrences(rule: Recurrence, start: number, end: number): number[] {
  const tz = rule.timezone;
  const result = new Set<number>();
  if (rule.freq === 'minutely' || rule.freq === 'hourly') {
    // Origin: the first instant whose local date is the anchor date or later.
    const anchorDay = isoToDay(rule.anchor);
    let origin = anchorDay * DAY - 2 * DAY;
    while (Math.floor((origin + offsetFor(tz, origin)) / DAY) < anchorDay) origin += MINUTE;
    const step = rule.interval * (rule.freq === 'minutely' ? MINUTE : 60 * MINUTE);
    const untilDay = rule.until ? isoToDay(rule.until) : Infinity;
    for (let t = Math.ceil(start / MINUTE) * MINUTE; t <= end; t += MINUTE) {
      if (t < origin || (t - origin) % step !== 0) continue;
      const localDay = Math.floor((t + offsetFor(tz, t)) / DAY);
      if (localDay > untilDay) continue;
      const dow = new Date(localDay * DAY).getUTCDay();
      if (rule.weekdaysOnly && (dow === 0 || dow === 6)) continue;
      if (rule.skipHolidays && isKoreanPublicHoliday(localDay)) continue;
      result.add(t);
    }
    return [...result].sort((a, b) => a - b);
  }
  const minutesOfDay = new Set((rule.times ?? []).map(({ hour, minute }) => hour * 60 + minute));
  const dayCache = new Map<number, boolean>();
  const matches = (wall: number) => {
    if (!minutesOfDay.has(Math.floor(wall / MINUTE) % 1440)) return false;
    const dayNo = Math.floor(wall / DAY);
    let hit = dayCache.get(dayNo);
    if (hit === undefined) {
      hit = dateMatches(rule, dayNo);
      dayCache.set(dayNo, hit);
    }
    return hit;
  };
  // Begin a little early so a gap or repeat straddling `start` is seen in full.
  let t = Math.floor(start / MINUTE) * MINUTE - 3 * 60 * MINUTE;
  let maxWall = -Infinity;
  for (; t <= end; t += MINUTE) {
    const wall = t + offsetFor(tz, t);
    if (wall > maxWall) {
      // Walls skipped by a forward jump run at this instant.
      if (maxWall !== -Infinity) {
        for (let skipped = maxWall + MINUTE; skipped < wall; skipped += MINUTE) {
          if (matches(skipped) && t >= start) result.add(t);
        }
      }
      if (matches(wall) && t >= start) result.add(t);
      maxWall = wall;
    }
  }
  return [...result].sort((a, b) => a - b);
}
