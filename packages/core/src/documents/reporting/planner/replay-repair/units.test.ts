import { describe, expect, it } from 'vitest';
import { formatFromExampleText } from './shared.js';

describe('a number written with its unit in the completed example', () => {
  it('keeps the unit as the format affix', () => {
    expect(formatFromExampleText('174건')).toEqual({ style: 'integer', suffix: '건' });
    expect(formatFromExampleText('8곳')).toEqual({ style: 'integer', suffix: '곳' });
    expect(formatFromExampleText('약 1,200명')).toEqual({ style: 'integer', prefix: '약 ', suffix: '명' });
    expect(formatFromExampleText('3.5배')).toEqual({ style: 'decimal', decimals: 1, suffix: '배' });
    expect(formatFromExampleText('28.5분')).toEqual({ style: 'decimal', decimals: 1, suffix: '분' });
    expect(formatFromExampleText('4.25점')).toEqual({ style: 'decimal', decimals: 2, suffix: '점' });
  });

  it('does not read a period as a count', () => {
    expect(formatFromExampleText('9월')).toBeUndefined();
    expect(formatFromExampleText('2분기')).toBeUndefined();
    expect(formatFromExampleText('Q3')).toBeUndefined();
    expect(formatFromExampleText('2026-08')).toBeUndefined();
  });

  it('still reads money and rates as before', () => {
    expect(formatFromExampleText('8,466,900원')).toMatchObject({ style: 'currency', currency: 'KRW' });
    expect(formatFromExampleText('47.7%')).toEqual({ style: 'percent', decimals: 1 });
  });
});
