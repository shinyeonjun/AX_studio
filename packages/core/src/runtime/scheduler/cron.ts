import { parseCronExpression, type ParsedCronExpression } from '../../workflow/cron.js';

export interface ScheduledJob {
  workflowId: string;
  schedule: string;
  timezone: string;
  nextRunAt?: string;
}

function zonedDateParts(
  date: Date,
  formatter: Intl.DateTimeFormat,
): { minute: number; hour: number; day: number; month: number; year: number; weekday: number } | null {
  try {
    const parts = formatter.formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.get('weekday') ?? '');
    const minute = Number(values.get('minute'));
    const hour = Number(values.get('hour'));
    const day = Number(values.get('day'));
    const month = Number(values.get('month'));
    const year = Number(values.get('year'));
    if ([weekday, minute, hour, day, month, year].some((value) => !Number.isInteger(value)) || weekday < 0) return null;
    return { minute, hour, day, month, year, weekday };
  } catch {
    return null;
  }
}

function createCronFormatter(timeZone?: string): Intl.DateTimeFormat | undefined {
  try {
    return new Intl.DateTimeFormat('en-US', {
      ...(timeZone ? { timeZone } : {}),
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
  } catch {
    return undefined;
  }
}

function calendarDayMatches(parsed: ParsedCronExpression, month: number, day: number, weekday: number): boolean {
  const dayMatches = parsed.day.has(day);
  const weekdayMatches = parsed.weekday.has(weekday);
  const calendarMatch = parsed.dayIsWildcard || parsed.weekdayIsWildcard
    ? dayMatches && weekdayMatches
    : dayMatches || weekdayMatches;
  return parsed.month.has(month) && calendarMatch;
}

function timezoneOffsetAt(timestamp: number, formatter: Intl.DateTimeFormat): number | undefined {
  const parts = zonedDateParts(new Date(timestamp), formatter);
  if (!parts) return undefined;
  const wallMinute = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return wallMinute - Math.floor(timestamp / 60_000) * 60_000;
}

function offsetsForLocalDate(year: number, month: number, day: number, formatter: Intl.DateTimeFormat): number[] {
  const localNoonAsUtc = Date.UTC(year, month - 1, day, 12);
  const offsets = new Set<number>();
  // Include offsets from both sides of nearby clock changes; candidates are
  // still checked against Intl so gaps are rejected and repeated times survive.
  for (const hours of [-36, -12, 0, 12, 36]) {
    const offset = timezoneOffsetAt(localNoonAsUtc + hours * 3_600_000, formatter);
    if (offset !== undefined) offsets.add(offset);
  }
  return [...offsets];
}

function hasPossibleCalendarDate(parsed: ParsedCronExpression): boolean {
  if (parsed.dayIsWildcard || !parsed.weekdayIsWildcard) return true;
  return [...parsed.month].some((month) => {
    // Use leap year 2000 so February 29 remains a valid recurring date.
    const lastDay = new Date(Date.UTC(2000, month, 0)).getUTCDate();
    return [...parsed.day].some((day) => day <= lastDay);
  });
}

export function compileCronMatcher(expr: string, timeZone?: string): ((date: Date) => boolean) | undefined {
  const parsed = parseCronExpression(expr);
  if (!parsed || !hasPossibleCalendarDate(parsed)) return undefined;
  const formatter = timeZone ? createCronFormatter(timeZone) : undefined;
  if (timeZone && !formatter) return undefined;

  return (date) => {
    const current = formatter
      ? zonedDateParts(date, formatter)
      : {
          minute: date.getMinutes(),
          hour: date.getHours(),
          day: date.getDate(),
          month: date.getMonth() + 1,
          weekday: date.getDay(),
        };
    if (!current) return false;

    return (
      parsed.minute.has(current.minute) &&
      parsed.hour.has(current.hour) &&
      calendarDayMatches(parsed, current.month, current.day, current.weekday)
    );
  };
}

function latestCronMatchOnDate(
  parsed: ParsedCronExpression,
  date: Date,
  from: number,
  to: number,
  formatter: Intl.DateTimeFormat,
  hours: number[],
  minutes: number[],
): number | undefined {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  if (!calendarDayMatches(parsed, month, day, date.getUTCDay())) return undefined;

  const offsets = offsetsForLocalDate(year, month, day, formatter);
  let latest: number | undefined;
  candidateLoop:
  for (const hour of hours) {
    for (const minute of minutes) {
      const wallMinute = Date.UTC(year, month - 1, day, hour, minute);
      for (const offset of offsets) {
        const timestamp = wallMinute - offset;
        if (timestamp < from || timestamp > to || timestamp % 60_000 !== 0) continue;
        const candidate = zonedDateParts(new Date(timestamp), formatter);
        if (
          candidate?.year === year && candidate.month === month && candidate.day === day &&
          candidate.hour === hour && candidate.minute === minute &&
          (latest === undefined || timestamp > latest)
        ) {
          latest = timestamp;
        }
      }
      // On an ordinary date, descending local times are also descending instants.
      if (offsets.length === 1 && latest !== undefined) break candidateLoop;
    }
  }
  return latest;
}

export function findLatestCronMatch(
  expr: string,
  from: Date,
  to: Date,
  timeZone?: string,
): Date | undefined {
  const fromTimestamp = from.getTime();
  const toTimestamp = to.getTime();
  const parsed = parseCronExpression(expr);
  if (
    !parsed || !hasPossibleCalendarDate(parsed) ||
    !Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp) ||
    fromTimestamp > toTimestamp
  ) return undefined;
  const formatter = createCronFormatter(timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (!formatter) return undefined;
  const dayLength = 86_400_000;
  const firstUtcDay = new Date(from);
  firstUtcDay.setUTCHours(0, 0, 0, 0);
  const lastUtcDay = new Date(to);
  lastUtcDay.setUTCHours(0, 0, 0, 0);
  // A timezone's local date can differ from UTC by a day. Scan that margin and
  // compare absolute instants so date-line changes cannot reorder occurrences.
  const firstDay = firstUtcDay.getTime() - dayLength;
  const lastDay = lastUtcDay.getTime() + dayLength;
  const hours = [...parsed.hour].sort((a, b) => b - a);
  const minutes = [...parsed.minute].sort((a, b) => b - a);
  let latestOverall: number | undefined;

  for (let dayTimestamp = lastDay; dayTimestamp >= firstDay; dayTimestamp -= dayLength) {
    const latestOnDate = latestCronMatchOnDate(
      parsed,
      new Date(dayTimestamp),
      fromTimestamp,
      toTimestamp,
      formatter,
      hours,
      minutes,
    );
    if (latestOnDate !== undefined && (latestOverall === undefined || latestOnDate > latestOverall)) {
      latestOverall = latestOnDate;
    }
  }
  return latestOverall === undefined ? undefined : new Date(latestOverall);
}

export function cronMatches(expr: string, date: Date, timeZone?: string): boolean {
  return compileCronMatcher(expr, timeZone)?.(date) ?? false;
}
