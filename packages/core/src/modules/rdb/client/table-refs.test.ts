import { describe, expect, it } from 'vitest';
import { formatRdbTableRef, parseRdbTableRef } from '../client.js';
describe('rdb table references', () => {
  it('parses and formats table refs', () => {
    expect(parseRdbTableRef('customers')).toEqual({ table: 'customers' });
    expect(parseRdbTableRef('public.customers')).toEqual({ schema: 'public', table: 'customers' });
    expect(parseRdbTableRef(' public.customers ')).toEqual({ schema: 'public', table: 'customers' });
    expect(parseRdbTableRef('bad-name')).toBeNull();
    expect(parseRdbTableRef('a.b.c')).toBeNull();
    expect(parseRdbTableRef(42)).toBeNull();
    expect(formatRdbTableRef({ table: 'customers' })).toBe('customers');
    expect(formatRdbTableRef({ schema: 'public', table: 'customers' })).toBe('public.customers');
  });
});
