import { decodeScheduleInputValue } from '../../../../workflow/schedule/input-value.js';
import type { DecisionAnswer, DecisionInstruction, DecisionQuestion } from '../../../../contracts/decision.js';
import { DECISION_CONTEXT_UNTRUSTED_DATA_POLICY } from '../../../decision/context.js';
import { choiceAnswerConfidence } from '../../../decision/confidence.js';
import { validateRecurrence } from '../../../../workflow/schedule/occurrences.js';
import {
  MAX_RECURRENCE_INTERVAL,
  WEEKDAY_CODES,
  type Recurrence,
  type RecurrenceFrequency,
  type WeekdayCode,
} from '../../../../workflow/schedule/recurrence.js';
import { formatClockTime } from '../../../../workflow/schedule/describe.js';
import { mondayIndex, dayNumber, zonedDateTime } from '../../../../workflow/schedule/zoned.js';

/*
 * Natural language → Recurrence through Jev's typed decisions. Every field of
 * the Recurrence model is a bounded choice (pattern, interval, hour, minute,
 * weekday, nth, month day, month), so the model only picks values and the host
 * composes and validates the rule. Anything unclear leaves the schedule blank
 * and the host schedule form asks the user instead.
 */

type Evaluate = (state: unknown, questions: Record<string, DecisionQuestion>) => Promise<{ answers: Record<string, DecisionAnswer> }>;

const MIN_CHOICE_CONFIDENCE = 0.5;
/** A weekday probability inside this band is treated as unsure. */
const UNSURE_BAND = [0.35, 0.65] as const;
const MAX_TIMES = 2;
const MAX_MONTH_DAYS = 2;
const WEEKDAY_NAMES: Record<WeekdayCode, string> = {
  MO: '월요일', TU: '화요일', WE: '수요일', TH: '목요일', FR: '금요일', SA: '토요일', SU: '일요일',
};

export const SCHEDULE_PATTERNS = {
  every_n_minutes: 'Repeats every N minutes all day (e.g. 30분마다, 10분 간격).',
  every_n_hours: 'Repeats every N hours all day (e.g. 매시간, 2시간마다).',
  daily: 'Every day, or every N days, at clock time(s) (e.g. 매일 오전 9시, 이틀마다).',
  weekdays: 'Every weekday Monday–Friday at clock time(s) (e.g. 평일, 주중, 근무일 아침).',
  weekly: 'On named day(s) of the week, every week or every N weeks (e.g. 매주 월요일, 격주 수요일 = every 2 weeks, 주말 = Saturday and Sunday).',
  monthly_day: 'On numbered day(s) of the month, every month or every N months (e.g. 매월 15일, 분기마다 1일 = every 3 months, 격월 = every 2 months).',
  monthly_nth_weekday: 'On the Nth weekday of the month (e.g. 매월 첫째 월요일, 셋째 주 금요일, 마지막 금요일).',
  monthly_last_day: 'On the last day of the month (e.g. 말일, 월말, 매월 마지막 날).',
  yearly: 'Once a year on a month and day (e.g. 매년 3월 1일).',
} as const;
type SchedulePattern = keyof typeof SCHEDULE_PATTERNS;

const PATTERN_FREQ: Record<SchedulePattern, RecurrenceFrequency> = {
  every_n_minutes: 'minutely',
  every_n_hours: 'hourly',
  daily: 'daily',
  weekdays: 'daily',
  weekly: 'weekly',
  monthly_day: 'monthly',
  monthly_nth_weekday: 'monthly',
  monthly_last_day: 'monthly',
  yearly: 'yearly',
};

const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, index) => start + index);

function choice(question: string, focus: string, criteria: Record<string, DecisionInstruction>): DecisionQuestion {
  return { type: 'choice', instructions: { question, focus }, criteria };
}

const NONE = { none: 'Not stated or unclear in the request; the host will ask the user.' };

function patternQuestions(): Record<string, DecisionQuestion> {
  const hours = Object.fromEntries(range(0, 23).map((hour) => [`h_${hour}`, { hour_24: hour, korean: formatClockTime({ hour, minute: 0 }) }]));
  const minutes = Object.fromEntries(range(0, 59).map((minute) => [`m_${minute}`, { minute }]));
  const timeFocus = 'Use the 24-hour clock: 오전/아침/새벽 are before noon, 오후/저녁/밤 are after noon (오후 6시 = 18, 밤 12시 = 0, 낮 12시 = 12). 반 means 30 minutes. If no clock time is stated, choose none.';
  return {
    schedule_pattern: choice(
      'Which recurring schedule pattern does the user request?',
      'Pick the single pattern that matches the stated cadence. Choose none when the cadence is missing, contradictory, or not one of these patterns (e.g. holidays, irregular dates).',
      { ...NONE, ...SCHEDULE_PATTERNS },
    ),
    schedule_interval: choice(
      'How many units apart are the repetitions (minutes, hours, days, weeks, months, or years for the chosen pattern)?',
      'Choose n_1 when the request just says every/매/평일. 격주 = n_2 (weeks), 격월 = n_2 (months), 분기 = n_3 (months), 반기 = n_6 (months), 이틀마다 = n_2 (days).',
      { ...NONE, ...Object.fromEntries(range(1, 60).map((value) => [`n_${value}`, { every: value }])) },
    ),
    schedule_time_1_hour: choice('At what hour is the first (earliest) requested run time?', timeFocus, { ...NONE, ...hours }),
    schedule_time_1_minute: choice('At what minute past the hour is the first requested run time?', `${timeFocus} An exact hour (정각, 9시) is m_0.`, { ...NONE, ...minutes }),
    schedule_time_2_hour: choice('If the user asks for a second, different run time on the same day, at what hour?', `${timeFocus} Choose none when only one time is requested.`, { ...NONE, ...hours }),
    schedule_time_2_minute: choice('At what minute is that second run time?', `${timeFocus} Choose none when only one time is requested.`, { ...NONE, ...minutes }),
  };
}

function detailQuestions(pattern: SchedulePattern): Record<string, DecisionQuestion> {
  const questions: Record<string, DecisionQuestion> = {};
  if (pattern === 'weekly' || pattern === 'monthly_nth_weekday') {
    for (const code of WEEKDAY_CODES) {
      questions[`schedule_day_${code}`] = {
        type: 'boolean',
        instructions: {
          question: `Does the requested schedule run on ${WEEKDAY_NAMES[code]} (${code})?`,
          focus: '주말 means Saturday and Sunday. Answer only from days the user named.',
        },
      };
    }
  }
  if (pattern === 'monthly_nth_weekday') {
    questions.schedule_nth = choice('Which occurrence of the weekday within the month?', '첫째 = first, 마지막 = last.', {
      ...NONE, nth_1: 'first (첫째)', nth_2: 'second (둘째)', nth_3: 'third (셋째)', nth_4: 'fourth (넷째)', nth_5: 'fifth (다섯째)', nth_last: 'last (마지막)',
    });
  }
  if (pattern === 'monthly_day' || pattern === 'yearly') {
    const days = { ...Object.fromEntries(range(1, 31).map((day) => [`d_${day}`, { day_of_month: day }])), d_last: 'the last day of the month (말일)' };
    questions.schedule_month_day_1 = choice('On which day of the month (the first one named)?', 'Choose none when no day of the month is stated.', { ...NONE, ...days });
    questions.schedule_month_day_2 = choice('If a second, different day of the month is named, which?', 'Choose none when only one day is named.', { ...NONE, ...days });
  }
  if (pattern === 'yearly') {
    questions.schedule_month = choice('In which month of the year?', 'Choose none when no month is stated.', {
      ...NONE, ...Object.fromEntries(range(1, 12).map((month) => [`month_${month}`, { month }])),
    });
  }
  return questions;
}

function chosen(answer: DecisionAnswer | undefined, allowed: ReadonlySet<string>): string | undefined {
  if (answer?.type !== 'choice' || answer.choice === 'none' || !allowed.has(answer.choice)) return undefined;
  return choiceAnswerConfidence(answer, answer.choice) >= MIN_CHOICE_CONFIDENCE ? answer.choice : undefined;
}

function chosenNumber(answer: DecisionAnswer | undefined, prefix: string, values: readonly number[]): number | undefined {
  const key = chosen(answer, new Set(values.map((value) => `${prefix}${value}`)));
  return key === undefined ? undefined : Number(key.slice(prefix.length));
}

export type ScheduleExtraction =
  | { kind: 'recurrence'; recurrence: Recurrence }
  | { kind: 'unclear'; reason: string };

export interface ScheduleExtractionContext {
  /** Current instant; the rule starts on this local date (it anchors 격주 parity). */
  now: Date;
  timeZone: string;
}

function today(context: ScheduleExtractionContext): { iso: string; label: string } {
  const local = zonedDateTime(context.now.getTime(), context.timeZone);
  const iso = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
  const weekday = WEEKDAY_NAMES[WEEKDAY_CODES[mondayIndex(dayNumber(local.year, local.month, local.day))]!];
  return { iso, label: `${iso} (${weekday})` };
}

/**
 * Composes and validates a Recurrence from typed answers. Pure: host-side
 * validation rejects any answer combination that is incomplete or impossible.
 */
export function composeRecurrence(
  answers: Record<string, DecisionAnswer>,
  context: ScheduleExtractionContext,
): ScheduleExtraction {
  const unclear = (reason: string): ScheduleExtraction => ({ kind: 'unclear', reason });
  const pattern = chosen(answers.schedule_pattern, new Set(Object.keys(SCHEDULE_PATTERNS))) as SchedulePattern | undefined;
  if (!pattern) return unclear('pattern');
  const freq = PATTERN_FREQ[pattern];
  // An explicit "none" means no interval phrase (매일, 매주 …), i.e. every period.
  const intervalAnswer = answers.schedule_interval;
  const interval = intervalAnswer?.type === 'choice' && intervalAnswer.choice === 'none'
    ? 1
    : chosenNumber(intervalAnswer, 'n_', range(1, 60));
  if (interval === undefined || interval > MAX_RECURRENCE_INTERVAL[freq]) return unclear('interval');
  const rule: Recurrence = {
    kind: 'recurrence', freq, interval, anchor: today(context).iso, timezone: context.timeZone,
  };

  if (freq !== 'minutely' && freq !== 'hourly') {
    const times: Array<{ hour: number; minute: number }> = [];
    for (let index = 1; index <= MAX_TIMES; index += 1) {
      const hour = chosenNumber(answers[`schedule_time_${index}_hour`], 'h_', range(0, 23));
      const minute = chosenNumber(answers[`schedule_time_${index}_minute`], 'm_', range(0, 59));
      if (hour === undefined) {
        if (index === 1) return unclear('time');
        continue;
      }
      times.push({ hour, minute: minute ?? 0 });
    }
    rule.times = [...new Map(times.map((time) => [`${time.hour}:${time.minute}`, time])).values()];
  }
  if (pattern === 'weekdays') rule.weekdaysOnly = true;
  if (pattern === 'weekly' || pattern === 'monthly_nth_weekday') {
    const days: WeekdayCode[] = [];
    for (const code of WEEKDAY_CODES) {
      const answer = answers[`schedule_day_${code}`];
      if (answer?.type !== 'boolean') return unclear('weekday');
      if (answer.probability > UNSURE_BAND[0] && answer.probability < UNSURE_BAND[1]) return unclear('weekday');
      if (answer.probability >= UNSURE_BAND[1]) days.push(code);
    }
    if (days.length === 0) return unclear('weekday');
    if (pattern === 'weekly') rule.byWeekday = days.map((day) => ({ day }));
    else {
      const nthKey = chosen(answers.schedule_nth, new Set(['nth_1', 'nth_2', 'nth_3', 'nth_4', 'nth_5', 'nth_last']));
      if (!nthKey) return unclear('nth');
      const nth = nthKey === 'nth_last' ? -1 : Number(nthKey.slice(4));
      rule.byWeekday = days.map((day) => ({ day, nth }));
    }
  }
  if (pattern === 'monthly_last_day') rule.byMonthDay = [-1];
  if (pattern === 'monthly_day' || pattern === 'yearly') {
    const allowed = new Set([...range(1, 31).map((day) => `d_${day}`), 'd_last']);
    const days = range(1, MAX_MONTH_DAYS)
      .map((index) => chosen(answers[`schedule_month_day_${index}`], allowed))
      .filter((key): key is string => key !== undefined)
      .map((key) => (key === 'd_last' ? -1 : Number(key.slice(2))));
    if (days.length === 0) return unclear('month_day');
    rule.byMonthDay = [...new Set(days)];
  }
  if (pattern === 'yearly') {
    const month = chosenNumber(answers.schedule_month, 'month_', range(1, 12));
    if (month === undefined) return unclear('month');
    rule.byMonth = [month];
  }
  const validated = validateRecurrence(rule);
  return validated.ok ? { kind: 'recurrence', recurrence: validated.recurrence } : unclear(validated.issues[0]?.code ?? 'invalid');
}

/**
 * Asks Jev the bounded schedule questions (two small rounds) and composes the rule. A schedule the
 * person already picked in the host schedule form travels with the request as a validated token;
 * it is used as chosen and never re-interpreted.
 */
export async function extractRecurrenceWithJev(
  request: string,
  context: ScheduleExtractionContext,
  evaluate: Evaluate,
): Promise<ScheduleExtraction> {
  const picked = decodeScheduleInputValue(request);
  if (picked) return { kind: 'recurrence', recurrence: picked };
  const state = {
    request,
    today: today(context).label,
    time_zone: context.timeZone,
    policy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
  };
  const first = await evaluate(state, patternQuestions());
  const pattern = chosen(first.answers.schedule_pattern, new Set(Object.keys(SCHEDULE_PATTERNS))) as SchedulePattern | undefined;
  if (!pattern) return { kind: 'unclear', reason: 'pattern' };
  const details = detailQuestions(pattern);
  const second = Object.keys(details).length > 0 ? await evaluate(state, details) : { answers: {} };
  return composeRecurrence({ ...first.answers, ...second.answers }, context);
}
