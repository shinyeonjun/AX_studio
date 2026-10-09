import { describe, expect, it } from 'vitest';
import { formatReportValue } from './format.js';

describe('writing an amount the way the report writes it', () => {
  it('lets a unit before or after the number stand for the currency', () => {
    expect(formatReportValue(8466900, { style: 'currency', currency: 'KRW', suffix: '원' })).toBe('8,466,900원');
    expect(formatReportValue(1000, { style: 'currency', currency: 'USD', prefix: '$' })).toBe('$1,000');
    expect(formatReportValue(1000, { style: 'currency', currency: 'KRW', prefix: 'KRW ' })).toBe('KRW 1,000');
  });

  it('names the currency on a bare number', () => {
    expect(formatReportValue(1000, { style: 'currency', currency: 'KRW' })).toBe('KRW 1,000');
  });
});

describe('writing a rate', () => {
  it('writes the percent sign once, even when the format also names it as its unit', () => {
    expect(formatReportValue(0.3267, { style: 'percent', decimals: 2 })).toBe('32.67%');
    expect(formatReportValue(0.3267, { style: 'percent', decimals: 2, suffix: '%' })).toBe('32.67%');
    expect(formatReportValue(0.012, { style: 'percent', decimals: 1, suffix: '%p' })).toBe('1.2%p');
  });
});
