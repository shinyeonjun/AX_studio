import { describe, expect, it, vi } from 'vitest';
import {
  formatRdbTableRef,
  isAllowedRdbTable,
  openRdbSqlClient,
  parseRdbTableRef,
} from './client.js';
import type { RdbConnectionConfig } from './connector.js';

const pgMock = vi.hoisted(() => {
  let clientConfig: {
    types?: { getTypeParser: (oid: number, format?: string) => (value: string) => unknown };
  } | undefined;
  const defaultTimestampParser = vi.fn((value: string) => `driver-timestamp:${value}`);
  const types = {
    builtins: { DATE: 1082, TIMESTAMP: 1114, TIMESTAMPTZ: 1184 },
    getTypeParser: vi.fn((oid: number) => {
      if (oid === 1082) return (value: string) => new Date(`${value}T00:00:00`);
      if (oid === 1114) return defaultTimestampParser;
      return (value: string) => value;
    }),
  };
  class FakeClient {
    constructor(config: typeof clientConfig) {
      clientConfig = config;
    }

    async connect(): Promise<void> {}

    async query(): Promise<{ rows: Array<Record<string, unknown>> }> {
      const dateParser = clientConfig?.types?.getTypeParser(1082, 'text')
        ?? ((value: string) => new Date(`${value}T00:00:00`));
      const timestampParser = clientConfig?.types?.getTypeParser(1114, 'text')
        ?? defaultTimestampParser;
      return {
        rows: [{
          signed_up: dateParser('2025-11-03'),
          occurred_at: timestampParser('2025-11-03 12:34:56'),
        }],
      };
    }

    async end(): Promise<void> {}
  }
  return { Client: FakeClient, types, defaultTimestampParser };
});

vi.mock('pg', () => ({ default: pgMock }));

const baseConfig = (overrides: Partial<RdbConnectionConfig> = {}): RdbConnectionConfig => ({
  type: 'postgres',
  connectionString: 'postgresql://example',
  ...overrides,
});

describe('rdb postgres result types', () => {
  it('keeps DATE values date-only while delegating timestamp parsing', async () => {
    const client = await openRdbSqlClient(baseConfig());
    try {
      const rows = await client.query('SELECT * FROM customers');

      expect(rows).toEqual([{
        signed_up: '2025-11-03',
        occurred_at: 'driver-timestamp:2025-11-03 12:34:56',
      }]);
      expect(JSON.parse(JSON.stringify(rows))).toEqual(rows);
      expect(pgMock.defaultTimestampParser).toHaveBeenCalledWith('2025-11-03 12:34:56');
    } finally {
      await client.close();
    }
  });
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

  it('enforces schema allowlists before allowing a table', () => {
    const config = baseConfig({
      allowedSchemas: ['public'],
      allowedTables: ['customers'],
    });
    expect(isAllowedRdbTable(config, { schema: 'public', table: 'customers' })).toBe(true);
    expect(isAllowedRdbTable(config, { schema: 'private', table: 'customers' })).toBe(false);
    expect(isAllowedRdbTable(config, { table: 'customers' })).toBe(false);
    expect(isAllowedRdbTable({ type: 'sqlite', filePath: '/tmp/app.db', allowedTables: ['customers'] }, {
      schema: 'attached',
      table: 'customers',
    })).toBe(false);
  });
});
