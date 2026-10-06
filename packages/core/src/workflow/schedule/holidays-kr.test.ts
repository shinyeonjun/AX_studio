import { describe, expect, it } from 'vitest';
import { isKoreanPublicHoliday, koreanPublicHolidays } from './holidays-kr.js';
import { civilDate, dayNumber, mondayIndex } from './zoned.js';

function listed(year: number): string[] {
  return [...koreanPublicHolidays(year).keys()].sort((left, right) => left - right).map((dayNo) => {
    const { month, day } = civilDate(dayNo);
    return `${month}/${day}`;
  });
}

const lunar = new Intl.DateTimeFormat('en-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
function lunarOf(dayNo: number): string {
  const parts = lunar.formatToParts(new Date(dayNo * 86_400_000));
  return `${parts.find((part) => part.type === 'month')?.value}/${parts.find((part) => part.type === 'day')?.value}`;
}

describe('Korean public holidays', () => {
  // Government-announced calendars, minus the days only an announcement can make (elections, 임시공휴일).
  it.each([
    [2024, '1/1 2/9 2/10 2/11 2/12 3/1 5/5 5/6 5/15 6/6 8/15 9/16 9/17 9/18 10/3 10/9 12/25'],
    [2025, '1/1 1/28 1/29 1/30 3/1 3/3 5/5 5/6 6/6 8/15 10/3 10/5 10/6 10/7 10/8 10/9 12/25'],
    [2026, '1/1 2/16 2/17 2/18 3/1 3/2 5/5 5/24 5/25 6/6 8/15 8/17 9/24 9/25 9/26 10/3 10/5 10/9 12/25'],
  ])('%i matches the announced calendar', (year, expected) => {
    expect(listed(year).join(' ')).toBe(expected);
  });

  const years = Array.from({ length: 2060 - 2024 + 1 }, (_, index) => 2024 + index);

  it.each(years)('%i: lunar holidays sit on their lunar dates and substitutes on free weekdays', (year) => {
    const holidays = koreanPublicHolidays(year);
    const names = [...holidays.values()];
    expect(names.filter((name) => name.includes('설날'))).toHaveLength(3);
    expect(names.filter((name) => name.includes('추석'))).toHaveLength(3);
    for (const [dayNo, name] of holidays) {
      if (name.includes('부처님오신날')) expect(lunarOf(dayNo)).toBe('4/8');
      if (name === '대체공휴일') {
        expect(mondayIndex(dayNo), `${year} ${civilDate(dayNo).month}/${civilDate(dayNo).day}`).toBeLessThan(5);
      }
    }
    const seollal = [...holidays].filter(([, name]) => name.includes('설날')).map(([dayNo]) => dayNo).sort((a, b) => a - b);
    expect(seollal.map(lunarOf)[1]).toBe('1/1');
    expect(seollal[2]! - seollal[0]!).toBe(2);
    // Every weekend 삼일절/광복절/개천절/한글날/성탄절 owes a substitute.
    const owed = [[3, 1], [8, 15], [10, 3], [10, 9], [12, 25]]
      .filter(([month, day]) => mondayIndex(dayNumber(year, month!, day!)) >= 5).length;
    expect(names.filter((name) => name === '대체공휴일').length).toBeGreaterThanOrEqual(owed);
  });

  it('answers by date', () => {
    expect(isKoreanPublicHoliday(dayNumber(2026, 9, 25))).toBe(true);
    expect(isKoreanPublicHoliday(dayNumber(2026, 9, 28))).toBe(false);
  });
});
