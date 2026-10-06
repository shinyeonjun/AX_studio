import { isKoreanPublicHoliday } from './holidays-kr.js';
import {
  parseIsoDate,
  recurrenceShapeIssues,
  RecurrenceSchema,
  WEEKDAY_CODES,
  type Recurrence,
  type RecurrenceIssue,
} from './recurrence.js';
import {
  civilDate,
  dayNumber,
  daysInMonth,
  localDayNumber,
  mondayIndex,
  resolveLocalTime,
} from './zoned.js';

/*
 * Complexity. Every query jumps straight to the period (day/week/month/year
 * step of `interval` from the anchor) that contains its start with O(1)
 * arithmetic, then walks whole periods, never minutes or idle days:
 * - nextOccurrences(rule, after, k): O((k + e) · |times| · |byX|) time zone
 *   lookups, where e is the number of empty periods skipped (bounded by
 *   MAX_EMPTY_PERIODS; e.g. day 31 skips short months) and |byX| the size of
 *   the day rule (weekdays / month days / months).
 * - findLatestOccurrence(rule, from, to): walks periods backwards from `to`,
 *   O((1 + e) · |times| · |byX|), independent of how long the app was closed.
 *   Minutely/hourly rules are O(1): the step index is computed directly.
 * Time zone lookups are O(1) amortized (see the offset cache in zoned.ts).
 */

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** A rule that yields nothing for this many consecutive periods is treated as exhausted. */
const MAX_EMPTY_PERIODS = 1_000;
/** Longest run of consecutive skipped days a catch-up walks back over (bounds work, not meaning). */
const MAX_SKIPPED_RUN = 32;

function isoDay(value: string): number {
  const date = parseIsoDate(value)!;
  return dayNumber(date.year, date.month, date.day);
}

function isWeekend(dayNo: number): boolean {
  return mondayIndex(dayNo) >= 5;
}

/** A local date on which the rule does not run (weekend for weekday rules, public holidays when skipped). */
function isSkippedDay(rule: Recurrence, dayNo: number): boolean {
  return (rule.weekdaysOnly === true && isWeekend(dayNo))
    || (rule.skipHolidays === 'KR' && isKoreanPublicHoliday(dayNo));
}

/** Matching day numbers of one month for monthly/yearly rules, ascending. */
function daysOfMonth(rule: Recurrence, year: number, month: number): number[] {
  const length = daysInMonth(year, month);
  const days = new Set<number>();
  for (const value of rule.byMonthDay ?? []) {
    const day = value > 0 ? value : length + 1 + value;
    if (day >= 1 && day <= length) days.add(day);
  }
  if (rule.byWeekday) {
    const firstWeekday = mondayIndex(dayNumber(year, month, 1));
    for (const { day: code, nth } of rule.byWeekday) {
      if (nth === undefined) continue;
      const first = 1 + ((WEEKDAY_CODES.indexOf(code) - firstWeekday + 7) % 7);
      const last = first + Math.floor((length - first) / 7) * 7;
      const day = nth > 0 ? first + (nth - 1) * 7 : last + (nth + 1) * 7;
      if (day >= 1 && day <= length) days.add(day);
    }
  }
  return [...days]
    .map((day) => dayNumber(year, month, day))
    .filter((dayNo) => !rule.weekdaysOnly || !isWeekend(dayNo))
    .sort((left, right) => left - right);
}

/** Period arithmetic of a daily/weekly/monthly/yearly rule (period 0 contains the anchor). */
interface PeriodPlan {
  /** Index of the period containing a local date (may be negative). */
  periodOf(dayNo: number): number;
  /** First local date of a period. */
  startOf(period: number): number;
  /** Candidate local dates of a period, ascending (anchor/until not applied). */
  datesOf(period: number): number[];
}

function periodPlan(rule: Recurrence): PeriodPlan {
  const anchorDay = isoDay(rule.anchor);
  const interval = rule.interval;
  if (rule.freq === 'daily') {
    return {
      periodOf: (dayNo) => Math.floor((dayNo - anchorDay) / interval),
      startOf: (period) => anchorDay + period * interval,
      datesOf: (period) => {
        const dayNo = anchorDay + period * interval;
        return rule.weekdaysOnly && isWeekend(dayNo) ? [] : [dayNo];
      },
    };
  }
  if (rule.freq === 'weekly') {
    const anchorWeek = anchorDay - mondayIndex(anchorDay);
    const step = 7 * interval;
    const offsets = [...new Set((rule.byWeekday ?? []).map(({ day }) => WEEKDAY_CODES.indexOf(day)))].sort((a, b) => a - b);
    return {
      periodOf: (dayNo) => Math.floor((dayNo - anchorWeek) / step),
      startOf: (period) => anchorWeek + period * step,
      datesOf: (period) => offsets.map((offset) => anchorWeek + period * step + offset),
    };
  }
  const anchor = civilDate(anchorDay);
  if (rule.freq === 'monthly') {
    const anchorMonth = anchor.year * 12 + anchor.month - 1;
    const monthOf = (period: number) => {
      const index = anchorMonth + period * interval;
      return { year: Math.floor(index / 12), month: (index % 12) + 1 };
    };
    return {
      periodOf: (dayNo) => {
        const { year, month } = civilDate(dayNo);
        return Math.floor((year * 12 + month - 1 - anchorMonth) / interval);
      },
      startOf: (period) => {
        const { year, month } = monthOf(period);
        return dayNumber(year, month, 1);
      },
      datesOf: (period) => {
        const { year, month } = monthOf(period);
        return rule.byMonth && !rule.byMonth.includes(month) ? [] : daysOfMonth(rule, year, month);
      },
    };
  }
  const months = [...new Set(rule.byMonth ?? [])].sort((a, b) => a - b);
  return {
    periodOf: (dayNo) => Math.floor((civilDate(dayNo).year - anchor.year) / interval),
    startOf: (period) => dayNumber(anchor.year + period * interval, 1, 1),
    datesOf: (period) => months.flatMap((month) => daysOfMonth(rule, anchor.year + period * interval, month)),
  };
}

/** Local dates in [fromDay, ∞) ∩ [anchor, until], ascending. */
function* datesAscending(rule: Recurrence, fromDay: number): Generator<number> {
  const plan = periodPlan(rule);
  const anchorDay = isoDay(rule.anchor);
  const untilDay = rule.until ? isoDay(rule.until) : Number.POSITIVE_INFINITY;
  const lower = Math.max(fromDay, anchorDay);
  let empty = 0;
  for (let period = Math.max(0, plan.periodOf(lower)); empty < MAX_EMPTY_PERIODS; period += 1) {
    if (plan.startOf(period) > untilDay) return;
    let produced = false;
    for (const dayNo of plan.datesOf(period)) {
      if (dayNo < lower) continue;
      if (dayNo > untilDay) return;
      if (isSkippedDay(rule, dayNo)) continue;
      produced = true;
      yield dayNo;
    }
    empty = produced ? 0 : empty + 1;
  }
}

/** Local dates in (-∞, toDay] ∩ [anchor, until], descending. */
function* datesDescending(rule: Recurrence, toDay: number): Generator<number> {
  const plan = periodPlan(rule);
  const anchorDay = isoDay(rule.anchor);
  const upper = rule.until ? Math.min(toDay, isoDay(rule.until)) : toDay;
  if (upper < anchorDay) return;
  let empty = 0;
  for (let period = plan.periodOf(upper); period >= 0 && empty < MAX_EMPTY_PERIODS; period -= 1) {
    let produced = false;
    for (const dayNo of plan.datesOf(period).reverse()) {
      if (dayNo > upper) continue;
      if (dayNo < anchorDay) return;
      if (isSkippedDay(rule, dayNo)) continue;
      produced = true;
      yield dayNo;
    }
    empty = produced ? 0 : empty + 1;
  }
}

function sortedTimes(rule: Recurrence): Array<{ hour: number; minute: number }> {
  return [...(rule.times ?? [])].sort((left, right) => left.hour - right.hour || left.minute - right.minute);
}

function dateInstants(rule: Recurrence, times: ReadonlyArray<{ hour: number; minute: number }>, dayNo: number): number[] {
  const { year, month, day } = civilDate(dayNo);
  // Several nonexistent times can collapse onto the same post-gap instant.
  return [...new Set(times.map(({ hour, minute }) => resolveLocalTime(rule.timezone, year, month, day, hour, minute)))]
    .sort((left, right) => left - right);
}

/** Instants of a calendar rule strictly after `after`, ascending and de-duplicated. */
function* calendarInstants(rule: Recurrence, after: number): Generator<number> {
  const times = sortedTimes(rule);
  // A day earlier covers zones whose local date is behind the UTC date of `after`.
  let last = Number.NEGATIVE_INFINITY;
  for (const dayNo of datesAscending(rule, localDayNumber(after, rule.timezone) - 1)) {
    for (const instant of dateInstants(rule, times, dayNo)) {
      if (instant <= after || instant <= last) continue;
      last = instant;
      yield instant;
    }
  }
}

function latestCalendarInstant(rule: Recurrence, from: number, to: number): number | undefined {
  const times = sortedTimes(rule);
  const lowestDay = localDayNumber(from, rule.timezone) - 1;
  for (const dayNo of datesDescending(rule, localDayNumber(to, rule.timezone) + 1)) {
    if (dayNo < lowestDay) return undefined;
    const instants = dateInstants(rule, times, dayNo).filter((instant) => instant <= to);
    const latest = instants.at(-1);
    if (latest !== undefined) return latest >= from ? latest : undefined;
  }
  return undefined;
}

interface ElapsedPlan {
  origin: number;
  step: number;
  /** First instant after the rule's last day, or +∞. */
  end: number;
}

function elapsedPlan(rule: Recurrence): ElapsedPlan {
  const anchor = parseIsoDate(rule.anchor)!;
  const origin = resolveLocalTime(rule.timezone, anchor.year, anchor.month, anchor.day, 0, 0);
  const step = rule.interval * (rule.freq === 'minutely' ? MINUTE_MS : 60 * MINUTE_MS);
  let end = Number.POSITIVE_INFINITY;
  if (rule.until) {
    const next = civilDate(isoDay(rule.until) + 1);
    end = resolveLocalTime(rule.timezone, next.year, next.month, next.day, 0, 0);
  }
  return { origin, step, end };
}

/** Instants of a minutely/hourly rule strictly after `after`, stepping in elapsed time from the anchor. */
function* elapsedInstants(rule: Recurrence, after: number): Generator<number> {
  const { origin, step, end } = elapsedPlan(rule);
  let index = Math.max(0, Math.floor((after - origin) / step) + 1);
  for (;;) {
    const instant = origin + index * step;
    if (instant >= end) return;
    const dayNo = localDayNumber(instant, rule.timezone);
    if (isSkippedDay(rule, dayNo)) {
      // Jump to the first step on or after the next local midnight (a skipped run of days is a few jumps).
      const next = civilDate(dayNo + 1);
      const nextStart = resolveLocalTime(rule.timezone, next.year, next.month, next.day, 0, 0);
      index = Math.max(index + 1, Math.ceil((nextStart - origin) / step));
      continue;
    }
    yield instant;
    index += 1;
  }
}

function latestElapsedInstant(rule: Recurrence, from: number, to: number): number | undefined {
  const { origin, step, end } = elapsedPlan(rule);
  let index = Math.floor((Math.min(to, end - 1) - origin) / step);
  // One jump per skipped day; skipped days come in short runs (a weekend plus a 연휴 and its substitute).
  for (let guard = 0; guard < MAX_SKIPPED_RUN && index >= 0; guard += 1) {
    const instant = origin + index * step;
    if (instant < from) return undefined;
    const dayNo = localDayNumber(instant, rule.timezone);
    if (!isSkippedDay(rule, dayNo)) return instant;
    const day = civilDate(dayNo);
    const dayStart = resolveLocalTime(rule.timezone, day.year, day.month, day.day, 0, 0);
    index = Math.min(index - 1, Math.floor((dayStart - 1 - origin) / step));
  }
  return undefined;
}

function isElapsed(rule: Recurrence): boolean {
  return rule.freq === 'minutely' || rule.freq === 'hourly';
}

/** The next `count` run instants strictly after `after`. Fewer when the rule ends. */
export function nextOccurrences(rule: Recurrence, after: Date, count: number): Date[] {
  const result: Date[] = [];
  if (count <= 0 || !Number.isFinite(after.getTime())) return result;
  const iterator = isElapsed(rule) ? elapsedInstants(rule, after.getTime()) : calendarInstants(rule, after.getTime());
  for (const instant of iterator) {
    result.push(new Date(instant));
    if (result.length >= count) break;
  }
  return result;
}

/** Latest occurrence in [from, to] (inclusive), for the scheduler's catch-up. Bounded; see the header. */
export function findLatestOccurrence(rule: Recurrence, from: Date, to: Date): Date | undefined {
  const start = from.getTime();
  const end = to.getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return undefined;
  const latest = isElapsed(rule) ? latestElapsedInstant(rule, start, end) : latestCalendarInstant(rule, start, end);
  return latest === undefined ? undefined : new Date(latest);
}

/** Shape + semantic issues, including rules that can never run. */
export function validateRecurrence(value: unknown): { ok: true; recurrence: Recurrence } | { ok: false; issues: RecurrenceIssue[] } {
  const parsed = RecurrenceSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, issues: [{ code: 'invalid_shape', message: '일정 형식이 올바르지 않습니다.' }] };
  }
  const issues = recurrenceShapeIssues(parsed.data);
  if (issues.length > 0) return { ok: false, issues };
  const anchor = parseIsoDate(parsed.data.anchor)!;
  // Two days before the anchor's UTC midnight precedes its local start in every zone.
  const beforeAnchor = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day) - 2 * DAY_MS);
  if (nextOccurrences(parsed.data, beforeAnchor, 1).length === 0) {
    return { ok: false, issues: [{ code: 'no_occurrence', message: '이 일정으로는 실행되는 날이 없습니다.' }] };
  }
  return { ok: true, recurrence: parsed.data };
}
