import { describe, expect, it } from 'vitest';
import { assertCsvShape, decodeCsvBytes, parseCsvMatrix, sniffCsvDelimiter } from './csv-parse.js';

describe('parseCsvMatrix', () => {
  it('ignores a UTF-8 BOM before plain or quoted headers', () => {
    expect(parseCsvMatrix('\uFEFFname,note\nAlice,hello')).toEqual({
      headers: ['name', 'note'],
      matrix: [['Alice', 'hello']],
    });
    expect(parseCsvMatrix('\uFEFF"first,name",note\nAlice,hello')).toEqual({
      headers: ['first,name', 'note'],
      matrix: [['Alice', 'hello']],
    });
  });

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

  it('preserves a quoted empty value in a single-column row', () => {
    expect(parseCsvMatrix('value\n""\n\nnext')).toEqual({
      headers: ['value'],
      matrix: [
        [''],
        ['next'],
      ],
    });
    expect(parseCsvMatrix('value\n""')).toEqual({
      headers: ['value'],
      matrix: [['']],
    });
  });

  it('treats CRLF and CR-only line endings as row breaks', () => {
    const expected = { headers: ['a', 'b'], matrix: [['1', '2'], ['3', '4']] };
    expect(parseCsvMatrix('a,b\r\n1,2\r\n3,4\r\n')).toEqual(expected);
    expect(parseCsvMatrix('a,b\r1,2\r3,4')).toEqual(expected);
    expect(parseCsvMatrix('a,b\r\n"x\r\ny",2')).toEqual({ headers: ['a', 'b'], matrix: [['x\r\ny', '2']] });
  });

  it('parses with a sniffed delimiter', () => {
    expect(sniffCsvDelimiter('a;b;c\n1;2,5;3')).toBe(';');
    expect(sniffCsvDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(sniffCsvDelimiter('a,b\n1,2')).toBe(',');
    expect(sniffCsvDelimiter('"x;y",b\n"1;2",3')).toBe(',');
    expect(sniffCsvDelimiter('a,b\n1,2', '.tsv')).toBe('\t');
    expect(parseCsvMatrix('a;b\n1;2,5', ';')).toEqual({ headers: ['a', 'b'], matrix: [['1', '2,5']] });
  });

  it('enforces width limits with the selected delimiter', () => {
    expect(() => assertCsvShape('a\tb\tc', 10, 2, '\t')).toThrow('workbook_sheet_too_wide');
    expect(() => assertCsvShape('a\rb\rc', 2, 10)).toThrow('workbook_sheet_too_large');
  });
});

describe('decodeCsvBytes', () => {
  // "이름,금액\n홍길동,1000" encoded as CP949 (EUC-KR superset used by Korean Excel).
  const cp949 = new Uint8Array([
    0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xb1, 0xdd, 0xbe, 0xd7, 0x0a,
    0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf, 0x2c, 0x31, 0x30, 0x30, 0x30,
  ]);

  it('falls back to EUC-KR when bytes are not valid UTF-8', () => {
    expect(decodeCsvBytes(cp949)).toBe('이름,금액\n홍길동,1000');
  });

  it('decodes UTF-8 with and without BOM', () => {
    const utf8 = new TextEncoder().encode('이름,금액');
    expect(decodeCsvBytes(utf8)).toBe('이름,금액');
    expect(decodeCsvBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe('이름,금액');
  });
});
