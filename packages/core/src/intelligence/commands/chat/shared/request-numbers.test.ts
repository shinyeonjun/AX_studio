import { describe, expect, it } from 'vitest';
import { numericValues } from './request-numbers.js';

describe('numbers a request states', () => {
  it('reads Korean units as their value, keeping the written number too', () => {
    expect(numericValues('금액 5만원 넘는 것')).toEqual([5, 50000]);
    expect(numericValues('1.5천 이하, 2억 이상')).toEqual([1.5, 1500, 2, 200000000]);
    expect(numericValues('10,000원 이상 30개')).toEqual([10000, 30]);
  });
});
