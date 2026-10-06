import { describe, expect, it } from 'vitest';
import { truncateToUtf8Bytes } from './file-name-bytes.js';

describe('truncateToUtf8Bytes', () => {
  it('keeps short names unchanged', () => {
    expect(truncateToUtf8Bytes('보고서.pdf', 180)).toBe('보고서.pdf');
  });

  it('cuts Korean text by bytes, not characters', () => {
    const cut = truncateToUtf8Bytes('가'.repeat(100), 180);
    expect(Buffer.byteLength(cut, 'utf8')).toBe(180);
    expect(Array.from(cut)).toHaveLength(60);
  });

  it('never splits a code point', () => {
    const cut = truncateToUtf8Bytes('ab😀😀', 7);
    expect(cut).toBe('ab😀');
  });
});
