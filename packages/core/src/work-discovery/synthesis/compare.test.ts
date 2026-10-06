import { describe, expect, it } from 'vitest';
import { compareObservationValue } from './compare.js';

const shown = (display: string, value: number) => ({ kind: 'number' as const, value, display });

describe('a computed number matches the example when it would be shown the same way', () => {
  it.each([
    ['12.3%', 12.3, 12.34, 1],
    ['12.3%', 12.3, 12.7, 0],
    ['12%', 12, 12.4, 1],
    ['12%', 12, 12.6, 0],
    ['1.2억', 120_000_000, 123_456_789, 1],
    ['1.2억', 120_000_000, 126_000_000, 0],
    ['1.2만', 12_000, 12_340, 1],
    ['1,234', 1234, 1234.4, 1],
    ['1,234', 1234, 1235, 0],
    ['3.14', 3.14, 3.17, 0],
  ])('%s vs %d', (display, value, actual, expected) => {
    expect(compareObservationValue(shown(display, value), actual)).toBe(expected);
  });

  it('does not read a blank cell as zero', () => {
    expect(compareObservationValue(shown('0', 0), '')).toBe(0);
    expect(compareObservationValue(shown('0', 0), '  ')).toBe(0);
  });

  it('keeps whole numbers without a display exact', () => {
    expect(compareObservationValue({ kind: 'number', value: 10 }, 10.4)).toBe(0);
  });
});
