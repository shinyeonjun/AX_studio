import { isValidCronExpression, isValidTimeZone } from '../cron.js';
import { cronAsDisplayRecurrence, nextCronOccurrences } from './cron-schedule.js';
import { nextOccurrences } from './occurrences.js';
import { parseIsoDate, RecurrenceSchema, type ClockTime, type Recurrence, type WeekdayCode } from './recurrence.js';
import { dayNumber, localTimeZone, mondayIndex, zonedDateTime } from './zoned.js';

/** Anything that carries a schedule: a schedule trigger, a canvas draft, or a bare recurrence. */
export interface ScheduleLike {
  schedule?: string;
  recurrence?: Recurrence;
  timezone?: string;
}

export const CUSTOM_SCHEDULE_LABEL = '사용자 지정 일정';

const WEEKDAY_LABEL: Record<WeekdayCode, string> = {
  MO: '월', TU: '화', WE: '수', TH: '목', FR: '금', SA: '토', SU: '일',
};
const WEEKDAY_BY_INDEX = ['월', '화', '수', '목', '금', '토', '일'];
const ORDINAL = ['', '첫째', '둘째', '셋째', '넷째', '다섯째'];

export function formatClockTime({ hour, minute }: ClockTime): string {
  const period = hour < 12 ? '오전' : '오후';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${period} ${hour12}:${String(minute).padStart(2, '0')}`;
}

function nthLabel(nth: number): string {
  if (nth > 0) return ORDINAL[nth] ?? `${nth}번째`;
  return nth === -1 ? '마지막' : `끝에서 ${ORDINAL[-nth] ?? `${-nth}번째`}`;
}

function monthDayLabel(day: number): string {
  if (day > 0) return `${day}일`;
  return day === -1 ? '마지막 날' : `끝에서 ${ORDINAL[-day] ?? `${-day}번째`} 날`;
}

function weekdayList(days: readonly WeekdayCode[]): string {
  const order: WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  return [...new Set(days)].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((day) => WEEKDAY_LABEL[day]).join('·') + '요일';
}

function timesLabel(times: readonly ClockTime[] | undefined): string {
  return [...(times ?? [])]
    .sort((left, right) => left.hour - right.hour || left.minute - right.minute)
    .map(formatClockTime)
    .join(', ');
}

function every(interval: number, unit: string, single: string): string {
  return interval === 1 ? single : `${interval}${unit}마다`;
}

function dayRuleLabel(rule: Recurrence): string {
  if (rule.byWeekday) {
    return rule.byWeekday.map(({ day, nth }) => `${nth === undefined ? '' : `${nthLabel(nth)} `}${WEEKDAY_LABEL[day]}요일`).join('·');
  }
  return [...(rule.byMonthDay ?? [])]
    .sort((left, right) => (left > 0 ? left : 100 - left) - (right > 0 ? right : 100 - right))
    .map(monthDayLabel)
    .join('·');
}

function monthsLabel(months: readonly number[]): string {
  return [...new Set(months)].sort((a, b) => a - b).join('·') + '월';
}

function untilLabel(until: string | undefined): string {
  const date = until ? parseIsoDate(until) : undefined;
  return date ? ` (${date.year}년 ${date.month}월 ${date.day}일까지)` : '';
}

/** Plain-Korean reading of a recurrence; never exposes rule syntax. */
export function describeRecurrence(rule: Recurrence, options: { viewerTimeZone?: string } = {}): string {
  const interval = rule.interval;
  let text: string;
  switch (rule.freq) {
    case 'minutely':
      text = `${rule.weekdaysOnly ? '평일 ' : ''}${interval}분마다`;
      break;
    case 'hourly':
      text = `${rule.weekdaysOnly ? '평일 ' : ''}${every(interval, '시간', '매시간')}`;
      break;
    case 'daily':
      text = rule.weekdaysOnly
        ? `${interval === 1 ? '평일' : `${interval}일마다 평일`} ${timesLabel(rule.times)}`
        : `${every(interval, '일', '매일')} ${timesLabel(rule.times)}`;
      break;
    case 'weekly':
      text = `${every(interval, '주', '매주')} ${weekdayList((rule.byWeekday ?? []).map(({ day }) => day))} ${timesLabel(rule.times)}`;
      break;
    case 'monthly': {
      const months = rule.byMonth ? ` (${monthsLabel(rule.byMonth)}만)` : '';
      text = `${every(interval, '개월', '매월')}${months} ${dayRuleLabel(rule)}${rule.weekdaysOnly ? ' (주말 제외)' : ''} ${timesLabel(rule.times)}`;
      break;
    }
    case 'yearly':
      text = `${every(interval, '년', '매년')} ${monthsLabel(rule.byMonth ?? [])} ${dayRuleLabel(rule)}${rule.weekdaysOnly ? ' (주말 제외)' : ''} ${timesLabel(rule.times)}`;
      break;
  }
  const zone = options.viewerTimeZone && options.viewerTimeZone !== rule.timezone ? ` (${rule.timezone} 기준)` : '';
  return `${text}${untilLabel(rule.until)}${zone}`;
}

function scheduleRecurrence(value: ScheduleLike): Recurrence | undefined {
  if (!value.recurrence) return undefined;
  const parsed = RecurrenceSchema.safeParse(value.recurrence);
  return parsed.success ? parsed.data : undefined;
}

function cronTimeZone(value: ScheduleLike): string {
  const zone = value.timezone?.trim();
  return zone && isValidTimeZone(zone) ? zone : localTimeZone();
}

/**
 * Plain-Korean description of a schedule (recurrence or legacy cron). A cron
 * without a plain reading becomes "사용자 지정 일정"; raw cron text is never returned.
 * Empty string when nothing is set yet.
 */
export function describeSchedule(value: ScheduleLike, options: { viewerTimeZone?: string } = {}): string {
  const recurrence = scheduleRecurrence(value);
  if (recurrence) return describeRecurrence(recurrence, options);
  const cron = value.schedule?.trim();
  if (!cron) return value.recurrence ? CUSTOM_SCHEDULE_LABEL : '';
  if (!isValidCronExpression(cron)) return CUSTOM_SCHEDULE_LABEL;
  const zone = cronTimeZone(value);
  const display = cronAsDisplayRecurrence(cron, zone);
  return display ? describeRecurrence(display, options) : CUSTOM_SCHEDULE_LABEL;
}

/** Next run instants of any schedule, ascending. */
export function nextScheduleRuns(value: ScheduleLike, after: Date, count: number): Date[] {
  const recurrence = scheduleRecurrence(value);
  if (recurrence) return nextOccurrences(recurrence, after, count);
  const cron = value.schedule?.trim();
  return cron ? nextCronOccurrences(cron, cronTimeZone(value), after, count) : [];
}

/** "10월 8일(수) 오전 10:00" in the schedule's zone; the year is added when it differs from `now`'s. */
export function formatRunTime(instant: Date, timeZone: string, now: Date = new Date()): string {
  const local = zonedDateTime(instant.getTime(), timeZone);
  const current = zonedDateTime(now.getTime(), timeZone);
  const weekday = WEEKDAY_BY_INDEX[mondayIndex(dayNumber(local.year, local.month, local.day))];
  const year = local.year === current.year ? '' : `${local.year}년 `;
  return `${year}${local.month}월 ${local.day}일(${weekday}) ${formatClockTime(local)}`;
}

/** The next few run times in plain Korean, e.g. ["10월 8일(수) 오전 10:00", …]. */
export function nextRunPreview(value: ScheduleLike, options: { now?: Date; count?: number } = {}): string[] {
  const now = options.now ?? new Date();
  const count = Math.max(1, Math.min(10, options.count ?? 3));
  const zone = scheduleRecurrence(value)?.timezone ?? cronTimeZone(value);
  return nextScheduleRuns(value, now, count).map((instant) => formatRunTime(instant, zone, now));
}

/** "다음 실행: 10월 8일(수) 오전 10:00, 10월 22일(수) 오전 10:00" or an empty string. */
export function nextRunSentence(value: ScheduleLike, options: { now?: Date; count?: number } = {}): string {
  const runs = nextRunPreview(value, options);
  return runs.length > 0 ? `다음 실행: ${runs.join(', ')}` : '';
}
