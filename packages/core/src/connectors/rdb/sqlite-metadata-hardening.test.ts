import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { RdbConnector } from './connector.js';

describe('SQLite physical metadata completeness', () => {
  let root: string;
  let connector: RdbConnector;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'ax-sqlite-metadata-'));
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    try {
      db.run('CREATE TABLE sqlitex (amount INTEGER, doubled INTEGER GENERATED ALWAYS AS (amount * 2) VIRTUAL)');
      db.run(`CREATE TABLE wide (${Array.from({ length: 231 }, (_, index) => `field_${index} TEXT`).join(', ')})`);
      const filePath = join(root, 'metadata.sqlite');
      writeFileSync(filePath, db.export());
      connector = new RdbConnector({ type: 'sqlite', filePath, allowedTables: ['sqlitex', 'wide'] });
    } finally { db.close(); }
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  it('lists a user table whose name resembles but does not use the reserved prefix', async () => {
    expect(await connector.execute('schema.describe', {}, { variables: {}, log: () => {} }))
      .toMatchObject({ ok: true, data: ['sqlitex', 'wide'] });
  });

  it('includes generated columns in physical metadata', async () => {
    expect(await connector.execute('table.describe', { table: 'sqlitex' }, { variables: {}, log: () => {} }))
      .toMatchObject({ ok: true, data: { columns: [{ name: 'amount' }, { name: 'doubled' }] } });
  });

  it('pages a wide dictionary without dropping columns or claiming one page is complete', async () => {
    const names: string[] = [];
    for (const offset of [0, 100, 200]) {
      const result = await connector.execute('table.describe', { table: 'wide', offset, limit: 100 },
        { executionId: 'metadata', variables: {}, log: () => {} });
      expect(result.ok).toBe(true);
      const page = result.data as { columns: { name: string }[]; hasMore: boolean; nextOffset?: number; completeness: unknown };
      expect(page.columns.length).toBe(offset < 200 ? 100 : 31);
      expect(page.hasMore).toBe(offset < 200);
      expect(page.nextOffset).toBe(offset < 200 ? offset + 100 : undefined);
      expect(page.completeness).toMatchObject({ status: 'partial', reason: 'provider_limit' });
      names.push(...page.columns.map(column => column.name));
    }
    expect(names).toEqual(Array.from({ length: 231 }, (_, index) => `field_${index}`));
  });

  it.each([{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 201 }])('rejects invalid dictionary pagination: %j', async params => {
    expect(await connector.execute('table.describe', { table: 'wide', ...params },
      { executionId: 'metadata', variables: {}, log: () => {} }))
      .toMatchObject({ ok: false, errorCode: 'invalid_params' });
  });
});
