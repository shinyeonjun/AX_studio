import {
  describeRecurrence,
  encodeScheduleInputValue,
  localTimeZone,
  nextRunPreview,
  validateRecurrence,
  type Recurrence,
  type WeekdayCode,
} from '@ax-studio/core/schedule';

/** What the user picks in the schedule form; every field is a plain choice, never rule syntax. */
export type RepeatKind = 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly' | 'yearly' | 'minutes' | 'hours';
export type MonthlyMode = 'day' | 'nth' | 'last';

export interface ScheduleDraft {
  repeat: RepeatKind;
  everyMinutes: number;
  everyHours: number;
  weekdays: WeekdayCode[];
  monthlyMode: MonthlyMode;
  monthDay: number;
  nth: number;
  nthWeekday: WeekdayCode;
  month: number;
  /** "HH:MM" values from time inputs. */
  times: string[];
  /** "YYYY-MM-DD"; interval counting (격주) starts from this date. */
  startDate: string;
  timezone: string;
}

export const REPEAT_OPTIONS: ReadonlyArray<{ value: RepeatKind; label: string }> = [
  { value: 'daily', label: '매일' },
  { value: 'weekdays', label: '평일 (월~금)' },
  { value: 'weekly', label: '매주' },
  { value: 'biweekly', label: '격주 (2주마다)' },
  { value: 'monthly', label: '매월' },
  { value: 'yearly', label: '매년' },
  { value: 'minutes', label: '몇 분마다' },
  { value: 'hours', label: '몇 시간마다' },
];

export const WEEKDAY_OPTIONS: ReadonlyArray<{ value: WeekdayCode; label: string }> = [
  { value: 'MO', label: '월' }, { value: 'TU', label: '화' }, { value: 'WE', label: '수' }, { value: 'TH', label: '목' },
  { value: 'FR', label: '금' }, { value: 'SA', label: '토' }, { value: 'SU', label: '일' },
];

export const MINUTE_STEPS = [5, 10, 15, 20, 30] as const;
export const HOUR_STEPS = [1, 2, 3, 4, 6, 12] as const;
export const NTH_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: '첫째' }, { value: 2, label: '둘째' }, { value: 3, label: '셋째' }, { value: 4, label: '넷째' },
  { value: 5, label: '다섯째' }, { value: -1, label: '마지막' },
];

const COMMON_TIME_ZONES = [
  'Asia/Seoul', 'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'UTC',
];

/** The computer's zone first (default), then common zones. */
export function timeZoneOptions(computerZone: string): Array<{ value: string; label: string }> {
  return [
    { value: computerZone, label: `이 컴퓨터 시간대 (${computerZone})` },
    ...COMMON_TIME_ZONES.filter((zone) => zone !== computerZone).map((zone) => ({ value: zone, label: zone })),
  ];
}

function isoDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  return parts.slice(0, 10);
}

export function defaultScheduleDraft(now: Date = new Date(), timezone: string = localTimeZone()): ScheduleDraft {
  return {
    repeat: 'daily',
    everyMinutes: 30,
    everyHours: 1,
    weekdays: ['MO'],
    monthlyMode: 'day',
    monthDay: 1,
    nth: 1,
    nthWeekday: 'MO',
    month: 1,
    times: ['09:00'],
    startDate: isoDate(now, timezone),
    timezone,
  };
}

function parseTimes(times: readonly string[]): Array<{ hour: number; minute: number }> | undefined {
  const parsed = times.map((value) => /^(\d{2}):(\d{2})$/u.exec(value.trim()))
    .map((match) => (match ? { hour: Number(match[1]), minute: Number(match[2]) } : undefined));
  if (parsed.length === 0 || parsed.some((time) => !time)) return undefined;
  const unique = new Map(parsed.map((time) => [`${time!.hour}:${time!.minute}`, time!]));
  return [...unique.values()].sort((left, right) => left.hour - right.hour || left.minute - right.minute);
}

export type ScheduleDraftResult =
  | { ok: true; recurrence: Recurrence; description: string; preview: string[]; value: string }
  | { ok: false; message: string };

/** Turns the form choices into a validated recurrence with its description and next runs. */
export function evaluateScheduleDraft(draft: ScheduleDraft, now: Date = new Date()): ScheduleDraftResult {
  const base = { kind: 'recurrence' as const, anchor: draft.startDate, timezone: draft.timezone };
  const times = parseTimes(draft.times);
  const needsTimes = draft.repeat !== 'minutes' && draft.repeat !== 'hours';
  if (needsTimes && !times) return { ok: false, message: '실행 시각을 하나 이상 정해 주세요.' };
  const withTimes = { ...base, times: times ?? [] };
  let candidate: Recurrence;
  switch (draft.repeat) {
    case 'minutes':
      candidate = { ...base, freq: 'minutely', interval: draft.everyMinutes };
      break;
    case 'hours':
      candidate = { ...base, freq: 'hourly', interval: draft.everyHours };
      break;
    case 'daily':
      candidate = { ...withTimes, freq: 'daily', interval: 1 };
      break;
    case 'weekdays':
      candidate = { ...withTimes, freq: 'daily', interval: 1, weekdaysOnly: true };
      break;
    case 'weekly':
    case 'biweekly':
      if (draft.weekdays.length === 0) return { ok: false, message: '요일을 하나 이상 골라 주세요.' };
      candidate = {
        ...withTimes, freq: 'weekly', interval: draft.repeat === 'biweekly' ? 2 : 1,
        byWeekday: WEEKDAY_OPTIONS.filter(({ value }) => draft.weekdays.includes(value)).map(({ value }) => ({ day: value })),
      };
      break;
    case 'monthly':
      candidate = {
        ...withTimes, freq: 'monthly', interval: 1,
        ...(draft.monthlyMode === 'nth'
          ? { byWeekday: [{ day: draft.nthWeekday, nth: draft.nth }] }
          : { byMonthDay: [draft.monthlyMode === 'last' ? -1 : draft.monthDay] }),
      };
      break;
    case 'yearly':
      candidate = { ...withTimes, freq: 'yearly', interval: 1, byMonth: [draft.month], byMonthDay: [draft.monthDay] };
      break;
  }
  const validated = validateRecurrence(candidate);
  if (!validated.ok) return { ok: false, message: validated.issues[0]?.message ?? '일정을 다시 확인해 주세요.' };
  const preview = nextRunPreview({ recurrence: validated.recurrence }, { now, count: 4 });
  return {
    ok: true,
    recurrence: validated.recurrence,
    description: describeRecurrence(validated.recurrence),
    preview,
    value: encodeScheduleInputValue(validated.recurrence),
  };
}
