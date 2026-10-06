import { describe, expect, it } from 'vitest';
import type { DecisionAnswer, DecisionQuestion } from '../../../../contracts/decision.js';
import { composeRecurrence, extractRecurrenceWithJev, SCHEDULE_PATTERNS } from './jev-schedule-extraction.js';
import { validateRecurrence } from '../../../../workflow/schedule/occurrences.js';
import { describeRecurrence } from '../../../../workflow/schedule/describe.js';
import { mulberry32, seedList } from '../../../../workflow/schedule/testing/random.js';

const context = { now: new Date('2026-10-06T03:00:00Z'), timeZone: 'Asia/Seoul' };
const pick = (choice: string, confidence = 0.95): DecisionAnswer => ({ type: 'choice', choice, probabilities: { [choice]: confidence }, confidence });
const yes = (probability: number): DecisionAnswer => ({ type: 'boolean', probability });
const days = (selected: string[]) => Object.fromEntries(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']
  .map((code) => [`schedule_day_${code}`, yes(selected.includes(code) ? 0.97 : 0.03)]));
const time = (hour: number, minute: number, second?: [number, number]) => ({
  schedule_time_1_hour: pick(`h_${hour}`), schedule_time_1_minute: pick(`m_${minute}`),
  schedule_time_2_hour: pick(second ? `h_${second[0]}` : 'none'), schedule_time_2_minute: pick(second ? `m_${second[1]}` : 'none'),
});

/** Fake Jev: answers only the questions it is asked, from a fixed answer sheet. */
function fakeEvaluate(sheet: Record<string, DecisionAnswer>) {
  const asked: string[][] = [];
  const evaluate = async (_state: unknown, questions: Record<string, DecisionQuestion>) => {
    asked.push(Object.keys(questions));
    return { answers: Object.fromEntries(Object.keys(questions).flatMap((id) => (sheet[id] ? [[id, sheet[id]!]] : []))) };
  };
  return { evaluate, asked };
}

describe('schedule extraction through Jev choices', () => {
  it.each<[string, Record<string, DecisionAnswer>, string]>([
    ['매일 오전 9시', { schedule_pattern: pick('daily'), schedule_interval: pick('n_1'), ...time(9, 0) }, '매일 오전 9:00'],
    ['평일 오후 6시 반', { schedule_pattern: pick('weekdays'), schedule_interval: pick('none'), ...time(18, 30) }, '평일 오후 6:30'],
    ['격주 수요일 오전 10시', { schedule_pattern: pick('weekly'), schedule_interval: pick('n_2'), ...time(10, 0), ...days(['WE']) }, '2주마다 수요일 오전 10:00'],
    ['매월 첫째 월요일 9시', { schedule_pattern: pick('monthly_nth_weekday'), schedule_interval: pick('n_1'), ...time(9, 0), ...days(['MO']), schedule_nth: pick('nth_1') }, '매월 첫째 월요일 오전 9:00'],
    ['매월 마지막 금요일 17시', { schedule_pattern: pick('monthly_nth_weekday'), schedule_interval: pick('n_1'), ...time(17, 0), ...days(['FR']), schedule_nth: pick('nth_last') }, '매월 마지막 금요일 오후 5:00'],
    ['말일 오후 6시', { schedule_pattern: pick('monthly_last_day'), schedule_interval: pick('n_1'), ...time(18, 0) }, '매월 마지막 날 오후 6:00'],
    ['분기마다 1일 9시', { schedule_pattern: pick('monthly_day'), schedule_interval: pick('n_3'), ...time(9, 0), schedule_month_day_1: pick('d_1'), schedule_month_day_2: pick('none') }, '3개월마다 1일 오전 9:00'],
    ['매일 9시와 18시 30분', { schedule_pattern: pick('daily'), schedule_interval: pick('n_1'), ...time(9, 0, [18, 30]) }, '매일 오전 9:00, 오후 6:30'],
    ['30분마다', { schedule_pattern: pick('every_n_minutes'), schedule_interval: pick('n_30') }, '30분마다'],
    ['매년 3월 1일', { schedule_pattern: pick('yearly'), schedule_interval: pick('n_1'), ...time(9, 0), schedule_month_day_1: pick('d_1'), schedule_month: pick('month_3') }, '매년 3월 1일 오전 9:00'],
  ])('%s', async (_request, sheet, description) => {
    const { evaluate } = fakeEvaluate(sheet);
    const result = await extractRecurrenceWithJev(_request, context, evaluate);
    expect(result.kind).toBe('recurrence');
    if (result.kind !== 'recurrence') return;
    expect(describeRecurrence(result.recurrence)).toBe(description);
    expect(result.recurrence).toMatchObject({ anchor: '2026-10-06', timezone: 'Asia/Seoul' });
  });

  it('asks the follow-up round only for patterns that need it', async () => {
    const daily = fakeEvaluate({ schedule_pattern: pick('daily'), schedule_interval: pick('n_1'), ...time(9, 0) });
    await extractRecurrenceWithJev('매일 9시', context, daily.evaluate);
    expect(daily.asked).toHaveLength(1);
    const weekly = fakeEvaluate({ schedule_pattern: pick('weekly'), schedule_interval: pick('n_1'), ...time(9, 0), ...days(['MO']) });
    await extractRecurrenceWithJev('매주 월요일 9시', context, weekly.evaluate);
    expect(weekly.asked[1]).toEqual(expect.arrayContaining(['schedule_day_MO', 'schedule_day_SU']));
  });

  it.each<[string, Record<string, DecisionAnswer>]>([
    ['no pattern', { schedule_pattern: pick('none') }],
    ['an unsure pattern', { schedule_pattern: pick('daily', 0.3), ...time(9, 0) }],
    ['a pattern outside the list', { schedule_pattern: pick('fortnightly_holiday'), ...time(9, 0) }],
    ['a missing clock time', { schedule_pattern: pick('daily'), schedule_interval: pick('n_1'), schedule_time_1_hour: pick('none') }],
    ['an hour outside 0-23', { schedule_pattern: pick('daily'), schedule_interval: pick('n_1'), schedule_time_1_hour: pick('h_24'), schedule_time_1_minute: pick('m_0') }],
    ['weekly with no weekday', { schedule_pattern: pick('weekly'), schedule_interval: pick('n_1'), ...time(9, 0), ...days([]) }],
    ['a weekday Jev is unsure about', { schedule_pattern: pick('weekly'), schedule_interval: pick('n_1'), ...time(9, 0), ...days(['MO']), schedule_day_TU: yes(0.5) }],
    ['nth weekday without an nth', { schedule_pattern: pick('monthly_nth_weekday'), schedule_interval: pick('n_1'), ...time(9, 0), ...days(['MO']), schedule_nth: pick('none') }],
    ['a date that never exists', { schedule_pattern: pick('yearly'), schedule_interval: pick('n_1'), ...time(9, 0), schedule_month_day_1: pick('d_30'), schedule_month: pick('month_2') }],
    ['an interval beyond the yearly limit', { schedule_pattern: pick('yearly'), schedule_interval: pick('n_40'), ...time(9, 0), schedule_month_day_1: pick('d_1'), schedule_month: pick('month_1') }],
  ])('leaves the schedule to the host form for %s', async (_label, sheet) => {
    const { evaluate } = fakeEvaluate(sheet);
    expect((await extractRecurrenceWithJev('요청', context, evaluate)).kind).toBe('unclear');
  });

  it.each(seedList(150))('never returns an invalid rule for random answer sheets (seed %i)', (seed) => {
    const random = mulberry32(seed + 31);
    const any = (values: string[]) => pick(values[Math.floor(random() * values.length)]!, random());
    const sheet: Record<string, DecisionAnswer> = {
      schedule_pattern: any(['none', ...Object.keys(SCHEDULE_PATTERNS), 'bogus']),
      schedule_interval: any(['none', 'n_1', 'n_2', 'n_3', 'n_12', 'n_60', 'n_0', 'x']),
      schedule_time_1_hour: any(['none', 'h_0', 'h_9', 'h_23', 'h_25']),
      schedule_time_1_minute: any(['none', 'm_0', 'm_30', 'm_59', 'm_60']),
      schedule_time_2_hour: any(['none', 'h_9', 'h_18']),
      schedule_time_2_minute: any(['none', 'm_0']),
      schedule_nth: any(['none', 'nth_1', 'nth_5', 'nth_last', 'nth_9']),
      schedule_month_day_1: any(['none', 'd_1', 'd_29', 'd_30', 'd_31', 'd_last', 'd_32']),
      schedule_month_day_2: any(['none', 'd_15', 'd_31']),
      schedule_month: any(['none', 'month_2', 'month_4', 'month_12', 'month_13']),
      ...Object.fromEntries(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].map((code) => [`schedule_day_${code}`, yes(random())])),
    };
    const result = composeRecurrence(sheet, context);
    if (result.kind === 'recurrence') {
      expect(validateRecurrence(result.recurrence).ok, `seed=${seed} ${JSON.stringify(sheet)}`).toBe(true);
    }
  });
});

describe('a schedule picked in the host form', () => {
  it('is used as chosen, without asking Jev', async () => {
    const { encodeScheduleInputValue } = await import('../../../../workflow/schedule/input-value.js');
    const picked = {
      kind: 'recurrence' as const, freq: 'monthly' as const, interval: 1, byWeekday: [{ day: 'FR' as const, nth: -1 }],
      times: [{ hour: 18, minute: 0 }], anchor: '2026-10-01', timezone: 'Asia/Seoul',
    };
    let asked = 0;
    const extraction = await extractRecurrenceWithJev(
      // The words say something else; the picked rule wins and is never re-interpreted.
      `DummyJSON 재고 표 매일 아침에 — 이 작업을 반복 업무로 만들어줘. 일정: ${encodeScheduleInputValue(picked)}`,
      { now: new Date('2026-10-06T00:00:00Z'), timeZone: 'Asia/Seoul' },
      async () => { asked += 1; return { answers: {} }; },
    );
    expect(extraction).toEqual({ kind: 'recurrence', recurrence: picked });
    expect(asked).toBe(0);
  });

  it('falls back to Jev when the token is malformed', async () => {
    let asked = 0;
    const extraction = await extractRecurrenceWithJev(
      '매주 월요일 9시 ⟦일정:not-a-valid-token⟧',
      { now: new Date('2026-10-06T00:00:00Z'), timeZone: 'Asia/Seoul' },
      async () => { asked += 1; return { answers: {} }; },
    );
    expect(asked).toBeGreaterThan(0);
    expect(extraction.kind).toBe('unclear');
  });
});

describe('holidays in a spoken schedule', () => {
  const weekdayNine = { schedule_pattern: pick('weekdays'), schedule_interval: pick('none'), ...time(9, 0) };

  it('skips public holidays only on a confident yes', async () => {
    for (const [probability, expected] of [[0.96, '평일 오전 9:00 (공휴일 제외)'], [0.5, '평일 오전 9:00'], [0.04, '평일 오전 9:00']] as const) {
      const { evaluate } = fakeEvaluate({ ...weekdayNine, schedule_skip_holidays: yes(probability) });
      const result = await extractRecurrenceWithJev('평일 9시, 공휴일은 빼고', context, evaluate);
      expect(result.kind === 'recurrence' && describeRecurrence(result.recurrence)).toBe(expected);
    }
  });
});
