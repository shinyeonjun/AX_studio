import { isValidCronExpression, isValidTimeZone } from './cron.js';

const WEEKDAYS: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

function clockTime(text: string): { hour: number; minute: number } | undefined {
  const match = /(오전|오후|아침|저녁|밤|새벽)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*(반))?/u.exec(text);
  if (!match) return undefined;
  let hour = Number(match[2]);
  const minute = match[4] ? 30 : match[3] ? Number(match[3]) : 0;
  const period = match[1];
  if ((period === '오후' || period === '저녁' || period === '밤') && hour < 12) hour += 12;
  // "밤 12시" and "새벽/오전 12시" are midnight; "오후/낮 12시" stays noon.
  if ((period === '오전' || period === '새벽' || period === '아침' || period === '밤') && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

/**
 * Turns common Korean schedule phrases ("매일 오전 9시", "평일 오후 6시 반", "매주 월요일 10시",
 * "매월 1일 9시", "30분마다", "매시간") into a cron expression. Deliberately conservative:
 * anything ambiguous returns undefined and the host asks the user. The result is only a
 * prefill that the user confirms on the job card before anything is saved.
 */
export function koreanScheduleToCron(text: string): string | undefined {
  const interval = /(\d{1,2})\s*분\s*마다/u.exec(text);
  if (interval) {
    const minutes = Number(interval[1]);
    return minutes >= 1 && minutes <= 59 ? `*/${minutes} * * * *` : undefined;
  }
  if (/매\s*시간|매시\s*정각/u.test(text)) return '0 * * * *';

  const time = clockTime(text);
  if (!time) return undefined;
  let dayOfMonth = '*';
  let dayOfWeek: string | undefined;
  const weekly = /매주\s*([월화수목금토일])요일/u.exec(text);
  const monthly = /매월\s*(\d{1,2})\s*일/u.exec(text);
  if (weekly) dayOfWeek = String(WEEKDAYS[weekly[1]!]);
  else if (monthly) {
    const day = Number(monthly[1]);
    if (day < 1 || day > 31) return undefined;
    dayOfMonth = String(day);
    dayOfWeek = '*';
  } else if (/평일|주중/u.test(text)) dayOfWeek = '1-5';
  else if (/주말/u.test(text)) dayOfWeek = '0,6';
  else if (/매일|날마다|매일\s*아침|하루\s*한\s*번/u.test(text)) dayOfWeek = '*';
  if (dayOfWeek === undefined) return undefined;
  const cron = `${time.minute} ${time.hour} ${dayOfMonth} * ${dayOfWeek}`;
  return isValidCronExpression(cron) ? cron : undefined;
}

/** The machine's IANA time zone, or Asia/Seoul when it cannot be resolved. */
export function localTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isValidTimeZone(zone)) return zone;
  } catch {
    // fall through
  }
  return 'Asia/Seoul';
}
