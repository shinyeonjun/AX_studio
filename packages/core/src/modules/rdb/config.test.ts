import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseRdbConnectionConfig, probeRdbConnection, validateRdbConnectionString } from './config.js';
import { createSqliteCustomersFixture } from './sqlite-test-fixture.js';

describe('validateRdbConnectionString', () => {
  it('rejects http URLs for postgres and mysql', () => {
    expect(validateRdbConnectionString('postgres', 'http://127.0.0.1:5432/db')).toBe('invalid_postgres_connection_string');
    expect(validateRdbConnectionString('mysql', 'http://127.0.0.1:3306/db')).toBe('invalid_mysql_connection_string');
  });

  it('accepts canonical postgres and mysql URLs', () => {
    expect(validateRdbConnectionString('postgres', 'postgresql://ax_test:ax_test@127.0.0.1:5432/ax_test')).toBeNull();
    expect(validateRdbConnectionString('mysql', 'mysql://ax_test:ax_test@127.0.0.1:3306/ax_test')).toBeNull();
  });
});

describe('rdb connection config', () => {
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

  it('probes a readable sqlite file and rejects a missing file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-rdb-config-'));
    try {
      const missing = await probeRdbConnection({ type: 'sqlite', filePath: join(root, 'missing.sqlite') });
      expect(missing.ok).toBe(false);
      if (!missing.ok) expect(missing.error).toBe('sqlite_file_unreadable');

      const fixture = await createSqliteCustomersFixture();
      try {
        const probe = await probeRdbConnection({ type: 'sqlite', filePath: fixture.filePath });
        expect(probe).toEqual({ ok: true });
      } finally {
        fixture.cleanup();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
