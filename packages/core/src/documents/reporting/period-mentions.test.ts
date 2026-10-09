import { describe, expect, it } from 'vitest';
import { dateMentions, mentionInPeriod } from './period-mentions.js';

const august = { start: '2026-08-01', endInclusive: '2026-08-31' };

describe('dates written in a report', () => {
  it('reads numeric and Korean dates, with and without a year', () => {
    expect(dateMentions('기간: 2026.08.01 ~ 2026.08.31').map((mention) => mention.text)).toEqual(['2026.08.01', '2026.08.31']);
    expect(dateMentions('2026년 8월 매출, 9월 5일 마감')).toEqual([
      { text: '2026년 8월', year: 2026, month: 8 },
      { text: '9월 5일', month: 9, day: 5 },
    ]);
    expect(dateMentions('매출 8,466,900원, 1,234건')).toEqual([]);
  });

  it('knows which mentions fall in the period', () => {
    const [full, bare, other] = dateMentions('2026-08 / 8월 / 2025년 8월');
    expect(mentionInPeriod(full!, august)).toBe(true);
    expect(mentionInPeriod(bare!, august)).toBe(true);
    expect(mentionInPeriod(other!, august)).toBe(false);
  });
});
