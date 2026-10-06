import { describe, expect, it } from 'vitest';
import {
  CUSTOM_SCHEDULE_LABEL,
  describeRecurrence,
  describeSchedule,
  formatClockTime,
  nextRunPreview,
} from './describe.js';
import { decodeScheduleInputValue, encodeScheduleInputValue, withoutScheduleTokens } from './input-value.js';
import { validateRecurrence } from './occurrences.js';
import { WEEKDAY_CODES, type Recurrence } from './recurrence.js';
import { mulberry32, seedList } from './testing/random.js';

const base = { kind: 'recurrence' as const, interval: 1, anchor: '2026-10-06', timezone: 'Asia/Seoul' };
const WEEKDAY_KO = { MO: '월', TU: '화', WE: '수', TH: '목', FR: '금', SA: '토', SU: '일' } as const;
const ORDINAL: Record<number, string> = { 1: '첫째', 2: '둘째', 3: '셋째', 4: '넷째', 5: '다섯째', [-1]: '마지막' };
/** Jargon a non-developer must never see. */
const JARGON = /cron|rrule|freq=|byday|bymonth|\*|\bMO\b|\bTU\b|\bWE\b|\bTH\b|\bFR\b|\bSA\b|\bSU\b|minutely|weekly|monthly/iu;

describe('describeSchedule', () => {
  it.each<[string, Partial<Recurrence>]>([
    ['매일 오전 9:00', { freq: 'daily', times: [{ hour: 9, minute: 0 }] }],
    ['평일 오전 9:00', { freq: 'daily', weekdaysOnly: true, times: [{ hour: 9, minute: 0 }] }],
    ['2주마다 수요일 오전 10:00', { freq: 'weekly', interval: 2, byWeekday: [{ day: 'WE' }], times: [{ hour: 10, minute: 0 }] }],
    ['매월 첫째 월요일 오전 9:00', { freq: 'monthly', byWeekday: [{ day: 'MO', nth: 1 }], times: [{ hour: 9, minute: 0 }] }],
    ['매월 마지막 날 오후 6:00', { freq: 'monthly', byMonthDay: [-1], times: [{ hour: 18, minute: 0 }] }],
    ['3개월마다 1일 오전 9:00', { freq: 'monthly', interval: 3, byMonthDay: [1], times: [{ hour: 9, minute: 0 }] }],
    ['매일 오전 9:00, 오후 6:30', { freq: 'daily', times: [{ hour: 18, minute: 30 }, { hour: 9, minute: 0 }] }],
    ['30분마다', { freq: 'minutely', interval: 30 }],
    ['매시간', { freq: 'hourly' }],
    ['매년 3월 1일 오전 12:00', { freq: 'yearly', byMonth: [3], byMonthDay: [1], times: [{ hour: 0, minute: 0 }] }],
  ])('reads %s', (expected, rule) => {
    expect(describeSchedule({ recurrence: { ...base, ...rule } as Recurrence })).toBe(expected);
  });

  it.each([
    ['0 9 * * *', '매일 오전 9:00'],
    ['0 9 * * 1-5', '평일 오전 9:00'],
    ['30 18 * * 1,3,5', '매주 월·수·금요일 오후 6:30'],
    ['0 9 1 * *', '매월 1일 오전 9:00'],
    ['0 9 1 1,4,7,10 *', '매년 1·4·7·10월 1일 오전 9:00'],
    ['*/30 * * * *', '30분마다'],
    ['0 * * * *', '매시간'],
    ['0 9,18 * * 0,6', '매주 토·일요일 오전 9:00, 오후 6:00'],
    ['0 9 1 * 1', CUSTOM_SCHEDULE_LABEL],
    ['*/7 * * * *', CUSTOM_SCHEDULE_LABEL],
    ['not a cron', CUSTOM_SCHEDULE_LABEL],
  ])('describes legacy cron %s without showing it', (cron, expected) => {
    expect(describeSchedule({ schedule: cron, timezone: 'Asia/Seoul' })).toBe(expected);
  });

  it('is empty only when nothing is set', () => {
    expect(describeSchedule({ schedule: '', timezone: '' })).toBe('');
  });

  it('previews the next runs in Korean with weekdays, honouring 격주 parity', () => {
    const rule: Recurrence = { ...base, freq: 'weekly', interval: 2, byWeekday: [{ day: 'WE' }], times: [{ hour: 10, minute: 0 }] };
    expect(nextRunPreview({ recurrence: rule }, { now: new Date('2026-10-06T00:00:00Z'), count: 3 }))
      .toEqual(['10월 7일(수) 오전 10:00', '10월 21일(수) 오전 10:00', '11월 4일(수) 오전 10:00']);
    expect(nextRunPreview({ schedule: '0 9 * * 1-5', timezone: 'Asia/Seoul' }, { now: new Date('2026-12-31T01:00:00Z'), count: 2 }))
      .toEqual(['2027년 1월 1일(금) 오전 9:00', '2027년 1월 4일(월) 오전 9:00']);
  });

  it.each(seedList(200))('mentions every element of a random rule and no jargon (seed %i)', (seed) => {
    const random = mulberry32(seed + 77);
    const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
    const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const times = Array.from({ length: int(1, 3) }, () => ({ hour: int(0, 23), minute: int(0, 59) }))
      .filter((time, index, all) => all.findIndex((other) => other.hour === time.hour && other.minute === time.minute) === index);
    const freq = pick(['minutely', 'hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const);
    const interval = pick([1, 1, 2, 3, 6]);
    const days = WEEKDAY_CODES.filter(() => random() < 0.4);
    const rule: Recurrence = {
      ...base, freq, interval,
      ...(freq === 'minutely' || freq === 'hourly' ? {} : { times }),
      ...(freq === 'weekly' ? { byWeekday: (days.length ? days : ['TH' as const]).map((day) => ({ day })) } : {}),
      ...(freq === 'monthly' || freq === 'yearly'
        ? random() < 0.5
          ? { byWeekday: [{ day: pick(WEEKDAY_CODES), nth: pick([1, 2, 3, 4, 5, -1]) }] }
          : { byMonthDay: [pick([1, 15, 28, 31, -1])] }
        : {}),
      ...(freq === 'yearly' ? { byMonth: [int(1, 12)] } : {}),
      ...(freq === 'daily' && random() < 0.4 ? { weekdaysOnly: true } : {}),
      ...(random() < 0.2 ? { until: '2027-05-31' } : {}),
    };
    if (!validateRecurrence(rule).ok) return;
    const text = describeRecurrence(rule);
    const context = `seed=${seed} rule=${JSON.stringify(rule)} text=${text}`;
    expect(text, context).not.toMatch(JARGON);
    for (const time of rule.times ?? []) expect(text, context).toContain(formatClockTime(time));
    for (const { day, nth } of rule.byWeekday ?? []) {
      expect(text, context).toContain(`${WEEKDAY_KO[day]}`);
      if (nth !== undefined) expect(text, context).toContain(ORDINAL[nth]);
    }
    for (const day of rule.byMonthDay ?? []) expect(text, context).toContain(day === -1 ? '마지막 날' : `${day}일`);
    for (const month of rule.byMonth ?? []) expect(text, context).toContain(`${month}월`);
    if (interval > 1) expect(text, context).toContain(`${interval}`);
    if (rule.weekdaysOnly) expect(text, context).toContain('평일');
    if (rule.until) expect(text, context).toContain('2027년 5월 31일까지');
  });
});

describe('schedule input value', () => {
  it('round-trips a validated recurrence and hides the token from chat text', () => {
    const rule: Recurrence = { ...base, freq: 'monthly', byWeekday: [{ day: 'FR', nth: -1 }], times: [{ hour: 17, minute: 0 }] };
    const value = encodeScheduleInputValue(rule);
    expect(decodeScheduleInputValue(`실행 일정: ${value}`)).toEqual(rule);
    expect(withoutScheduleTokens(`실행 일정: ${value}`)).toBe('실행 일정: 매월 마지막 금요일 오후 5:00');
  });

  it('rejects tokens that do not decode to a valid rule', () => {
    const invalid = { ...base, freq: 'weekly', times: [{ hour: 9, minute: 0 }] };
    const token = btoa(JSON.stringify(invalid)).replace(/=+$/u, '');
    expect(decodeScheduleInputValue(`매주 ⟦일정:${token}⟧`)).toBeUndefined();
    expect(decodeScheduleInputValue('매일 오전 9:00')).toBeUndefined();
    expect(decodeScheduleInputValue('⟦일정:%%%⟧')).toBeUndefined();
  });
});
