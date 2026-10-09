/**
 * Dates written in a report: "2026-08", "2026.08.31", "2026/8/1", "2026년 8월 31일", and a bare
 * month "8월" / "8월 31일". Used to keep last period's dates out of the form a new report reuses.
 */
export interface DateMention {
  text: string;
  year?: number;
  month: number;
  day?: number;
}

// One separator throughout: 2026-08-31, 2026/8/31, 2026.08.31, 2026. 8. 31.
const NUMERIC = /(?<!\d)(\d{4})(-|\/|\.\s?)(\d{1,2})(?:\2(\d{1,2}))?(?!\d)/gu;
const KOREAN = /(?:(\d{4})\s*년\s*)?(?<!\d)(\d{1,2})\s*월(?:\s*(\d{1,2})\s*일)?/gu;

function valid(month: number, day?: number, year?: number): boolean {
  // A year keeps "1234.5" (a number) from reading as a date.
  return (year === undefined || (year >= 1900 && year <= 2199))
    && month >= 1 && month <= 12 && (day === undefined || (day >= 1 && day <= 31));
}

export function dateMentions(text: string): DateMention[] {
  const found: Array<DateMention & { start: number; end: number }> = [];
  for (const match of text.matchAll(NUMERIC)) {
    const month = Number(match[3]);
    const day = match[4] === undefined ? undefined : Number(match[4]);
    if (!valid(month, day, Number(match[1]))) continue;
    found.push({ text: match[0], year: Number(match[1]), month, ...(day !== undefined ? { day } : {}),
      start: match.index!, end: match.index! + match[0].length });
  }
  for (const match of text.matchAll(KOREAN)) {
    const start = match.index!;
    if (found.some((item) => start < item.end && item.start < start + match[0].length)) continue;
    const month = Number(match[2]);
    const day = match[3] === undefined ? undefined : Number(match[3]);
    if (!valid(month, day)) continue;
    found.push({ text: match[0], ...(match[1] ? { year: Number(match[1]) } : {}), month,
      ...(day !== undefined ? { day } : {}), start, end: start + match[0].length });
  }
  return found.sort((left, right) => left.start - right.start).map(({ start: _start, end: _end, ...mention }) => mention);
}

/** Whether the mention falls in the period (ISO start and inclusive end); a bare month matches by month. */
export function mentionInPeriod(mention: DateMention, period: { start: string; endInclusive: string }): boolean {
  const [startYear, startMonth] = period.start.split('-').map(Number) as [number, number];
  const [endYear, endMonth] = period.endInclusive.split('-').map(Number) as [number, number];
  const months: Array<[number, number]> = [];
  for (let year = startYear, month = startMonth; year < endYear || (year === endYear && month <= endMonth);) {
    months.push([year, month]);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    if (months.length > 36) break;
  }
  return months.some(([year, month]) => month === mention.month && (mention.year === undefined || mention.year === year));
}
