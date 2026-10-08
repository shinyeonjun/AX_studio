import { describe, expect, it } from 'vitest';
import { findSheet } from './sheet.js';

describe('finding a sheet by the name a person typed', () => {
  const sheets = [{ name: '1월매출' }, { name: 'Summary' }, { name: 'a b' }, { name: 'ab' }];

  it('accepts other spacing and capitals when only one sheet fits', () => {
    expect(findSheet(sheets, '1월 매출')?.name).toBe('1월매출');
    expect(findSheet(sheets, 'summary')?.name).toBe('Summary');
  });

  it('prefers the exact name, and guesses nothing when two sheets fit', () => {
    expect(findSheet(sheets, 'a b')?.name).toBe('a b');
    expect(findSheet(sheets, 'A B')).toBeUndefined();
  });
});
