import { describe, expect, it } from 'vitest';
import { parseWrittenNumber } from './number-text.js';

describe('a number as people write it', () => {
  it.each([
    ['₩1,200,000', 1_200_000],
    ['￦1,200,000', 1_200_000], // Korean Excel's CSV (CP949) writes the full-width won sign
    ['1,000원', 1000],
    ['(50,000)', -50_000],
    ['12.5%', 12.5],
    ['0x10', null],
    ['', null],
    ['미정', null],
  ])('%s -> %s', (text, expected) => {
    expect(parseWrittenNumber(text)).toBe(expected);
  });
});
