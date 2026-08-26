import { describe, expect, it } from 'vitest';
import { parseCsvMatrix } from './csv-parse.js';

describe('parseCsvMatrix', () => {
  it('parses quoted commas, escaped quotes, and newlines', () => {
    expect(parseCsvMatrix('name,note\nAlice,"one, two"\nBob,"said ""hello""\nnext line"')).toEqual({
      headers: ['name', 'note'],
      matrix: [
        ['Alice', 'one, two'],
        ['Bob', 'said "hello"\nnext line'],
      ],
    });
  });

  it('preserves literal quotes in unquoted fields', () => {
    expect(parseCsvMatrix('item,size\nBolt,5"')).toEqual({
      headers: ['item', 'size'],
      matrix: [['Bolt', '5"']],
    });
  });

  it('preserves comma-delimited rows whose fields are empty', () => {
    expect(parseCsvMatrix('first,second\n,\nvalue,present')).toEqual({
      headers: ['first', 'second'],
      matrix: [
        ['', ''],
        ['value', 'present'],
      ],
    });
  });
});
