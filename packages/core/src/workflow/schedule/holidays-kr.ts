import { civilDate, dayNumber, mondayIndex } from './zoned.js';

/*
 * Korean public holidays (관공서의 공휴일에 관한 규정), computed rather than listed:
 * - fixed solar dates;
 * - lunar dates (설날 연휴, 부처님오신날, 추석 연휴) from the Korean lunisolar calendar
 *   ('dangi') that ICU ships with Node and Chromium;
 * - substitute holidays (대체공휴일) from the rules in force since 2023-05-04.
 * Election days and one-off temporary holidays (임시공휴일) are announced, not computable,
 * so they are not included; callers say so to people.
 */

type HolidayRule = 'none' | 'weekend' | 'weekend_or_overlap' | 'lunar_holiday_period';

interface Holiday {
  dayNo: number;
  name: string;
  /** How a clash makes a substitute day; 연휴 days share one decision per period. */
  substitute: HolidayRule;
  period?: string;
}

const SOLAR: ReadonlyArray<{ month: number; day: number; name: string; substitute: HolidayRule }> = [
  { month: 1, day: 1, name: '신정', substitute: 'none' },
  { month: 3, day: 1, name: '삼일절', substitute: 'weekend' },
  { month: 5, day: 5, name: '어린이날', substitute: 'weekend_or_overlap' },
  { month: 6, day: 6, name: '현충일', substitute: 'none' },
  { month: 8, day: 15, name: '광복절', substitute: 'weekend' },
  { month: 10, day: 3, name: '개천절', substitute: 'weekend' },
  { month: 10, day: 9, name: '한글날', substitute: 'weekend' },
  { month: 12, day: 25, name: '성탄절', substitute: 'weekend' },
];

let lunarFormatter: Intl.DateTimeFormat | undefined;

/** Lunar month/day of a civil date; leap months are reported apart (e.g. '4bis'), never as the plain month. */
function lunarMonthDay(dayNo: number): { month: string; day: number } | undefined {
  try {
    lunarFormatter ??= new Intl.DateTimeFormat('en-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return undefined;
  }
  const parts = lunarFormatter.formatToParts(new Date(dayNo * 86_400_000));
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return month && Number.isInteger(day) ? { month, day } : undefined;
}

function lunarHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = [];
  const first = dayNumber(year, 1, 1);
  const last = dayNumber(year, 12, 31);
  for (let dayNo = first; dayNo <= last; dayNo += 1) {
    const lunar = lunarMonthDay(dayNo);
    if (!lunar) return [];
    if (lunar.month === '1' && lunar.day === 1) {
      holidays.push(...[-1, 0, 1].map((offset) => ({ dayNo: dayNo + offset, name: '설날', substitute: 'lunar_holiday_period' as const, period: `seollal-${year}` })));
    } else if (lunar.month === '4' && lunar.day === 8) {
      holidays.push({ dayNo, name: '부처님오신날', substitute: 'weekend' });
    } else if (lunar.month === '8' && lunar.day === 15) {
      holidays.push(...[-1, 0, 1].map((offset) => ({ dayNo: dayNo + offset, name: '추석', substitute: 'lunar_holiday_period' as const, period: `chuseok-${year}` })));
    }
  }
  return holidays;
}

const isSaturday = (dayNo: number) => mondayIndex(dayNo) === 5;
const isSunday = (dayNo: number) => mondayIndex(dayNo) === 6;

/**
 * Dates after which a substitute day is owed, one entry per substitute, in date order:
 * - a holiday that substitutes for weekends (삼일절·광복절·개천절·한글날·부처님오신날·성탄절·어린이날)
 *   falling on a Saturday or Sunday;
 * - 어린이날 sharing a weekday with another holiday (two holidays on one day owe one substitute);
 * - a 설날/추석 연휴 that touches a Sunday or another holiday: one day after the 연휴.
 */
function substituteClaims(holidays: readonly Holiday[]): number[] {
  const byDay = new Map<number, Holiday[]>();
  for (const holiday of holidays) byDay.set(holiday.dayNo, [...(byDay.get(holiday.dayNo) ?? []), holiday]);
  const claims: number[] = [];
  for (const [dayNo, sameDay] of byDay) {
    if (isSaturday(dayNo) || isSunday(dayNo)) {
      for (const holiday of sameDay) {
        if (holiday.substitute === 'weekend' || holiday.substitute === 'weekend_or_overlap') claims.push(dayNo);
      }
    } else if (sameDay.length > 1 && !sameDay.some((holiday) => holiday.period)
      && sameDay.some((holiday) => holiday.substitute === 'weekend_or_overlap')) {
      claims.push(dayNo);
    }
  }
  for (const period of new Set(holidays.flatMap((holiday) => holiday.period ? [holiday.period] : []))) {
    const days = holidays.filter((holiday) => holiday.period === period).map((holiday) => holiday.dayNo);
    if (days.some((day) => isSunday(day) || (byDay.get(day)?.length ?? 0) > 1)) claims.push(Math.max(...days));
  }
  return claims.sort((left, right) => left - right);
}

const cache = new Map<number, ReadonlyMap<number, string>>();

/** Local dates (day numbers) of one year's public holidays, with their names. */
export function koreanPublicHolidays(year: number): ReadonlyMap<number, string> {
  const cached = cache.get(year);
  if (cached) return cached;
  const holidays: Holiday[] = [
    ...SOLAR.map(({ month, day, name, substitute }) => ({ dayNo: dayNumber(year, month, day), name, substitute })),
    ...lunarHolidays(year),
  ];
  const names = new Map<number, string>();
  for (const holiday of holidays) names.set(holiday.dayNo, names.has(holiday.dayNo) ? `${names.get(holiday.dayNo)}·${holiday.name}` : holiday.name);
  for (const after of substituteClaims(holidays)) {
    let dayNo = after + 1;
    while (isSaturday(dayNo) || isSunday(dayNo) || names.has(dayNo)) dayNo += 1;
    names.set(dayNo, '대체공휴일');
  }
  // 설날 연휴 can start in the previous civil year only in theory; keep each year's own dates.
  const own = new Map([...names].filter(([dayNo]) => civilDate(dayNo).year === year));
  cache.set(year, own);
  return own;
}

export function isKoreanPublicHoliday(dayNo: number): boolean {
  return koreanPublicHolidays(civilDate(dayNo).year).has(dayNo);
}
