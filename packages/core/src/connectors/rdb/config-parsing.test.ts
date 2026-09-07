import { describe, expect, it } from 'vitest';
import { parseRdbConnectionConfig } from './config.js';

describe('rdb connection config parsing', () => {
  it('parses sqlite, postgres, and mysql configs', () => {
    expect(parseRdbConnectionConfig({
      type: 'sqlite',
      filePath: '/tmp/app.db',
      allowedTables: ['users'],
      rowLimit: 500,
    })).toEqual({
      type: 'sqlite',
      filePath: '/tmp/app.db',
      allowedSchemas: undefined,
      allowedTables: ['users'],
      rowLimit: 500,
    });

    expect(parseRdbConnectionConfig({
      type: 'postgres',
      connectionString: 'postgresql://user:pass@localhost/db',
      allowedSchemas: ['public'],
      allowedTables: ['public.users'],
    })).toEqual({
      type: 'postgres',
      connectionString: 'postgresql://user:pass@localhost/db',
      allowedSchemas: ['public'],
      allowedTables: ['public.users'],
      rowLimit: undefined,
    });

    expect(parseRdbConnectionConfig({
      type: 'mysql',
      connectionString: 'mysql://user:pass@localhost:3306/db',
    })).toEqual({
      type: 'mysql',
      connectionString: 'mysql://user:pass@localhost:3306/db',
      allowedSchemas: undefined,
      allowedTables: undefined,
      rowLimit: undefined,
    });
    expect(parseRdbConnectionConfig({ type: 'oracle' })).toBeNull();
    expect(parseRdbConnectionConfig({ type: 'sqlite' })).toBeNull();
  });
  it('normalizes row limits to a safe positive integer', () => {
    const parseRowLimit = (rowLimit: unknown) => parseRdbConnectionConfig({ type: 'sqlite', filePath: '/tmp/app.db', rowLimit })?.rowLimit;

    expect(parseRowLimit(0.5)).toBe(1);
    expect(parseRowLimit(12.9)).toBe(12);
    expect(parseRowLimit(20_000)).toBe(10_000);
    expect(parseRowLimit(0)).toBeUndefined();
    expect(parseRowLimit(-1)).toBeUndefined();
    expect(parseRowLimit(Number.NaN)).toBeUndefined();
  });
});
