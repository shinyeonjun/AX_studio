import { parseCronExpression } from '../../workflow/cron.js';

export interface ScheduledJob {
  workflowId: string;
  schedule: string;
  timezone: string;
  nextRunAt?: string;
}

function zonedDateParts(date: Date, timeZone: string): { minute: number; hour: number; day: number; month: number; weekday: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.get('weekday') ?? '');
    const minute = Number(values.get('minute'));
    const hour = Number(values.get('hour'));
    const day = Number(values.get('day'));
    const month = Number(values.get('month'));
    if ([weekday, minute, hour, day, month].some((value) => !Number.isInteger(value)) || weekday < 0) return null;
    return { minute, hour, day, month, weekday };
  } catch {
    return null;
  }
}

export function cronMatches(expr: string, date: Date, timeZone?: string): boolean {
  const parsed = parseCronExpression(expr);
  if (!parsed) return false;
  const current = timeZone
    ? zonedDateParts(date, timeZone)
    : {
        minute: date.getMinutes(),
        hour: date.getHours(),
        day: date.getDate(),
        month: date.getMonth() + 1,
        weekday: date.getDay(),
  };
  if (!current) return false;

  const dayMatches = parsed.day.has(current.day);
  const weekdayMatches = parsed.weekday.has(current.weekday);
  const calendarDayMatches = parsed.dayIsWildcard || parsed.weekdayIsWildcard
    ? dayMatches && weekdayMatches
    : dayMatches || weekdayMatches;
  return (
    parsed.minute.has(current.minute) &&
    parsed.hour.has(current.hour) &&
    calendarDayMatches &&
    parsed.month.has(current.month)
  );
}
