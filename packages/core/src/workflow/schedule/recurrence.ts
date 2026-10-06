import { z } from 'zod';
import { isValidTimeZone } from '../cron.js';

/**
 * Typed recurrence rule (a strict subset of RFC 5545 RRULE semantics, never a
 * string). Interval counting is anchored on `anchor` (a local calendar date):
 * - daily: whole days since the anchor date
 * - weekly: whole Monday-based weeks since the anchor's week (격주 parity)
 * - monthly / yearly: calendar months / years since the anchor's month / year
 * - minutely / hourly: elapsed real time since the first instant of the anchor date
 * Public holidays are out of scope: `weekdaysOnly` only excludes Saturday and Sunday.
 */
export const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
export type WeekdayCode = (typeof WEEKDAY_CODES)[number];

export const RECURRENCE_FREQUENCIES = ['minutely', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/** Upper bounds keep every rule cheap to evaluate and easy to describe. */
export const MAX_RECURRENCE_INTERVAL: Record<RecurrenceFrequency, number> = {
  minutely: 720,
  hourly: 168,
  daily: 366,
  weekly: 52,
  monthly: 36,
  yearly: 10,
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

export function parseIsoDate(value: string): { year: number; month: number; day: number } | undefined {
  const match = ISO_DATE.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1970 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }
  return { year, month, day };
}

const IsoDateSchema = z.string().refine((value) => parseIsoDate(value) !== undefined, '날짜는 YYYY-MM-DD 형식이어야 합니다.');

export const ClockTimeSchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
}).strict();
export type ClockTime = z.infer<typeof ClockTimeSchema>;

export const RecurrenceWeekdaySchema = z.object({
  day: z.enum(WEEKDAY_CODES),
  /** Nth weekday of the month (1..5 from the start, -1..-5 from the end). Monthly/yearly only. */
  nth: z.number().int().min(-5).max(5).refine((value) => value !== 0, 'nth는 0일 수 없습니다.').optional(),
}).strict();
export type RecurrenceWeekday = z.infer<typeof RecurrenceWeekdaySchema>;

const MonthDaySchema = z.number().int().min(-31).max(31).refine((value) => value !== 0, '0일은 없습니다.');

export const RecurrenceSchema = z.object({
  kind: z.literal('recurrence'),
  freq: z.enum(RECURRENCE_FREQUENCIES),
  interval: z.number().int().min(1),
  times: z.array(ClockTimeSchema).min(1).max(24).optional(),
  byWeekday: z.array(RecurrenceWeekdaySchema).min(1).max(35).optional(),
  /** Day of month; negative values count from the end (-1 = last day). Missing days are skipped. */
  byMonthDay: z.array(MonthDaySchema).min(1).max(31).optional(),
  byMonth: z.array(z.number().int().min(1).max(12)).min(1).max(12).optional(),
  /** Excludes Saturday and Sunday. Public holidays are not considered. */
  weekdaysOnly: z.boolean().optional(),
  anchor: IsoDateSchema,
  until: IsoDateSchema.optional(),
  timezone: z.string().min(1),
}).strict();
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export interface RecurrenceIssue {
  code:
    | 'invalid_shape'
    | 'invalid_timezone'
    | 'interval_out_of_range'
    | 'times_required'
    | 'times_not_allowed'
    | 'weekday_required'
    | 'weekday_not_allowed'
    | 'nth_not_allowed'
    | 'nth_required'
    | 'month_day_not_allowed'
    | 'month_not_allowed'
    | 'month_required'
    | 'day_rule_required'
    | 'weekdays_only_not_allowed'
    | 'duplicate_value'
    | 'until_before_anchor'
    | 'no_occurrence';
  message: string;
}

function hasDuplicates(values: readonly unknown[]): boolean {
  return new Set(values.map((value) => JSON.stringify(value))).size !== values.length;
}

/**
 * Semantic checks beyond the zod shape. Each frequency accepts one canonical
 * combination so a rule always has exactly one plain-language reading.
 * (`no_occurrence` is checked by `validateRecurrence` in occurrences.ts.)
 */
export function recurrenceShapeIssues(rule: Recurrence): RecurrenceIssue[] {
  const issues: RecurrenceIssue[] = [];
  const add = (code: RecurrenceIssue['code'], message: string) => issues.push({ code, message });
  if (!isValidTimeZone(rule.timezone)) add('invalid_timezone', '시간대를 확인할 수 없습니다.');
  if (rule.interval > MAX_RECURRENCE_INTERVAL[rule.freq]) add('interval_out_of_range', '반복 간격이 너무 깁니다.');
  if (rule.until !== undefined && rule.until < rule.anchor) add('until_before_anchor', '종료일이 시작일보다 빠릅니다.');
  if (rule.times && hasDuplicates(rule.times)) add('duplicate_value', '같은 시각이 두 번 들어 있습니다.');
  if (rule.byWeekday && hasDuplicates(rule.byWeekday)) add('duplicate_value', '같은 요일이 두 번 들어 있습니다.');
  if (rule.byMonthDay && hasDuplicates(rule.byMonthDay)) add('duplicate_value', '같은 날짜가 두 번 들어 있습니다.');
  if (rule.byMonth && hasDuplicates(rule.byMonth)) add('duplicate_value', '같은 달이 두 번 들어 있습니다.');

  const subDaily = rule.freq === 'minutely' || rule.freq === 'hourly';
  if (subDaily) {
    if (rule.times) add('times_not_allowed', '분·시간 단위 반복에는 시각을 따로 정하지 않습니다.');
    if (rule.byWeekday) add('weekday_not_allowed', '분·시간 단위 반복에는 요일을 고를 수 없습니다.');
    if (rule.byMonthDay) add('month_day_not_allowed', '분·시간 단위 반복에는 날짜를 고를 수 없습니다.');
    if (rule.byMonth) add('month_not_allowed', '분·시간 단위 반복에는 월을 고를 수 없습니다.');
    return issues;
  }
  if (!rule.times) add('times_required', '실행 시각이 필요합니다.');
  if (rule.freq === 'daily') {
    if (rule.byWeekday) add('weekday_not_allowed', '매일 반복에는 요일을 고르지 않습니다. 매주 반복을 사용해 주세요.');
    if (rule.byMonthDay) add('month_day_not_allowed', '매일 반복에는 날짜를 고르지 않습니다.');
    if (rule.byMonth) add('month_not_allowed', '매일 반복에는 월을 고르지 않습니다.');
    return issues;
  }
  if (rule.freq === 'weekly') {
    if (!rule.byWeekday) add('weekday_required', '요일을 하나 이상 골라 주세요.');
    if (rule.byWeekday?.some((entry) => entry.nth !== undefined)) add('nth_not_allowed', '몇째 주 요일은 매월·매년 반복에서만 쓸 수 있습니다.');
    if (rule.byMonthDay) add('month_day_not_allowed', '매주 반복에는 날짜를 고르지 않습니다.');
    if (rule.byMonth) add('month_not_allowed', '매주 반복에는 월을 고르지 않습니다.');
    if (rule.weekdaysOnly) add('weekdays_only_not_allowed', '매주 반복은 고른 요일에만 실행됩니다.');
    return issues;
  }
  // monthly / yearly
  if (rule.freq === 'yearly' && !rule.byMonth) add('month_required', '몇 월인지 골라 주세요.');
  const dayRules = Number(Boolean(rule.byMonthDay)) + Number(Boolean(rule.byWeekday));
  if (dayRules !== 1) add('day_rule_required', '날짜 또는 몇째 주 요일 중 하나를 골라 주세요.');
  if (rule.byWeekday?.some((entry) => entry.nth === undefined)) add('nth_required', '몇째 주인지 골라 주세요.');
  if (rule.weekdaysOnly && !rule.byMonthDay) add('weekdays_only_not_allowed', '주말 제외는 날짜로 정한 반복에만 쓸 수 있습니다.');
  return issues;
}
