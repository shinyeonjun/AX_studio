import { describe, expect, it } from 'vitest';
import { formatTableNumber } from './table-display.js';

describe('numbers in a table, as people read them', () => {
  it.each([
    [1096000, '1,096,000'],
    [10000, '10,000'],
    [2026, '2026'],
    [42, '42'],
    [-25000, '-25,000'],
    [291.428571, '291.43'],
    [0.123456, '0.1235'],
    [12345.678, '12,345.68'],
  ])('%s -> %s', (value, shown) => {
    expect(formatTableNumber(value)).toBe(shown);
  });
});
