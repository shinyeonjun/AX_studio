import { parseCronExpression, type ParsedCronExpression } from '../cron.js';
import { WEEKDAY_CODES, type Recurrence } from './recurrence.js';
import { civilDate, exactLocalInstants, localDayNumber, mondayIndex } from './zoned.js';

/** Cron calendars repeat within 28 years; this bound only stops impossible dates (e.g. Feb 31). */
const MAX_SCAN_DAYS = 366 * 8;

function cronWeekday(dayNo: number): number {
  // Cron weekdays: 0 = Sunday … 6 = Saturday.
  return (mondayIndex(dayNo) + 1) % 7;
}

function cronDayMatches(parsed: ParsedCronExpression, dayNo: number): boolean {
  const { month, day } = civilDate(dayNo);
  const dayMatches = parsed.day.has(day);
  const weekdayMatches = parsed.weekday.has(cronWeekday(dayNo));
  const calendar = parsed.dayIsWildcard || parsed.weekdayIsWildcard
    ? dayMatches && weekdayMatches
    : dayMatches || weekdayMatches;
  return parsed.month.has(month) && calendar;
}

/**
 * Next run instants of a legacy cron schedule, with the scheduler's cron
 * semantics: nonexistent local times are skipped and a repeated local time
 * matches each time it occurs. Used only for previews.
 */
export function nextCronOccurrences(expression: string, timeZone: string, after: Date, count: number): Date[] {
  const parsed = parseCronExpression(expression);
  const result: Date[] = [];
  if (!parsed || count <= 0 || !Number.isFinite(after.getTime())) return result;
  const hours = [...parsed.hour].sort((a, b) => a - b);
  const minutes = [...parsed.minute].sort((a, b) => a - b);
  const start = localDayNumber(after.getTime(), timeZone) - 1;
  for (let dayNo = start; dayNo < start + MAX_SCAN_DAYS && result.length < count; dayNo += 1) {
    if (!cronDayMatches(parsed, dayNo)) continue;
    const { year, month, day } = civilDate(dayNo);
    const instants: number[] = [];
    timeLoop:
    for (const hour of hours) {
      for (const minute of minutes) {
        for (const instant of exactLocalInstants(timeZone, year, month, day, hour, minute)) {
          if (instant > after.getTime()) instants.push(instant);
        }
        // Local times ascend with instants except around a repeated hour, so a small surplus suffices.
        if (instants.length >= count + 2) break timeLoop;
      }
    }
    for (const instant of [...new Set(instants)].sort((a, b) => a - b)) {
      if (result.length < count) result.push(new Date(instant));
    }
  }
  return result;
}

function isFullRange(values: Set<number>, minimum: number, maximum: number): boolean {
  return values.size === maximum - minimum + 1;
}

/** Arithmetic progression `start, start+step, …` covering exactly the field's range from 0. */
function stepFromZero(values: Set<number>, maximum: number): number | undefined {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length < 2 || sorted[0] !== 0) return undefined;
  const step = sorted[1]! - sorted[0]!;
  if ((maximum + 1) % step !== 0 || sorted.length !== (maximum + 1) / step) return undefined;
  return sorted.every((value, index) => value === index * step) ? step : undefined;
}

/**
 * A recurrence that reads the same as a common cron form, for plain-language
 * display only (the scheduler keeps running the cron itself). Undefined when
 * the cron has no faithful plain reading.
 */
export function cronAsDisplayRecurrence(expression: string, timeZone: string): Recurrence | undefined {
  const parsed = parseCronExpression(expression);
  if (!parsed) return undefined;
  const base = { kind: 'recurrence' as const, interval: 1, anchor: '2000-01-03', timezone: timeZone };
  const allCalendar = parsed.dayIsWildcard && parsed.weekdayIsWildcard && isFullRange(parsed.month, 1, 12)
    && isFullRange(parsed.day, 1, 31) && isFullRange(parsed.weekday, 0, 6);
  const allHours = isFullRange(parsed.hour, 0, 23);
  if (allCalendar && allHours && isFullRange(parsed.minute, 0, 59)) return { ...base, freq: 'minutely' };
  const minuteStep = stepFromZero(parsed.minute, 59);
  if (allCalendar && allHours && minuteStep && 60 % minuteStep === 0) {
    return { ...base, freq: 'minutely', interval: minuteStep };
  }
  if (parsed.minute.size === 1 && allCalendar) {
    if (allHours) return { ...base, freq: 'hourly' };
    const hourStep = stepFromZero(parsed.hour, 23);
    if (hourStep && hourStep < 24) return { ...base, freq: 'hourly', interval: hourStep };
  }
  const times = [...parsed.hour].sort((a, b) => a - b)
    .flatMap((hour) => [...parsed.minute].sort((a, b) => a - b).map((minute) => ({ hour, minute })));
  if (times.length > 12) return undefined;
  const allMonths = isFullRange(parsed.month, 1, 12);
  const weekdays = [...parsed.weekday].sort((a, b) => a - b);
  const byWeekday = [...weekdays.filter((day) => day !== 0), ...weekdays.filter((day) => day === 0)]
    .map((day) => ({ day: WEEKDAY_CODES[(day + 6) % 7]! }));
  if (parsed.dayIsWildcard && parsed.weekdayIsWildcard) {
    if (!allMonths || !isFullRange(parsed.day, 1, 31) || !isFullRange(parsed.weekday, 0, 6)) return undefined;
    return { ...base, freq: 'daily', times };
  }
  if (parsed.dayIsWildcard && !parsed.weekdayIsWildcard) {
    if (!allMonths || !isFullRange(parsed.day, 1, 31)) return undefined;
    if (weekdays.join(',') === '1,2,3,4,5') return { ...base, freq: 'daily', times, weekdaysOnly: true };
    return { ...base, freq: 'weekly', times, byWeekday };
  }
  if (!parsed.dayIsWildcard && parsed.weekdayIsWildcard && isFullRange(parsed.weekday, 0, 6)) {
    const byMonthDay = [...parsed.day].sort((a, b) => a - b);
    if (allMonths) return { ...base, freq: 'monthly', times, byMonthDay };
    return { ...base, freq: 'yearly', times, byMonthDay, byMonth: [...parsed.month].sort((a, b) => a - b) };
  }
  return undefined;
}
