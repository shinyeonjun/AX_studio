import { describe, expect, it } from 'vitest';
import {
  formatRdbTableRef,
  isAllowedRdbTable,
  parseRdbTableRef,
} from './client.js';
import type { RdbConnectionConfig } from './connector.js';

const baseConfig = (overrides: Partial<RdbConnectionConfig> = {}): RdbConnectionConfig => ({
  type: 'postgres',
  connectionString: 'postgresql://example',
  ...overrides,
});

describe('rdb client helpers', () => {
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

  it('enforces table allowlists', () => {
    const config = baseConfig({ allowedTables: ['public.customers', 'orders'] });
    expect(isAllowedRdbTable(config, { schema: 'public', table: 'customers' })).toBe(true);
    expect(isAllowedRdbTable(config, { table: 'orders' })).toBe(true);
    expect(isAllowedRdbTable(config, { table: 'secret' })).toBe(false);
    expect(isAllowedRdbTable(baseConfig({ allowedTables: [] }), { table: 'customers' })).toBe(false);
    expect(isAllowedRdbTable(baseConfig(), { table: 'customers' })).toBe(false);
  });
});
