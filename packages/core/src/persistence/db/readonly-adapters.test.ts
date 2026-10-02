import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlJsDatabase, openReadonlySqlJs } from './sqljs.js';
import { openReadonlyNativeSqlite } from '../db-native.js';
import type { AppDatabase } from '../db.js';
const writers: AppDatabase[] = [];
afterEach(() => writers.splice(0).forEach(db => db.close?.()));
describe.each(['sqljs', 'native'] as const)('%s external SQLite read adapter', backend => {
  it('rejects mutation, connection pragmas and multiple statements while preserving metadata reads', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ax-readonly-fixture-')), 'synthetic.sqlite');
    const writer = await createSqlJsDatabase(path); writers.push(writer);
    writer.exec('CREATE TABLE fixture (value INTEGER)'); writer.prepare('INSERT INTO fixture VALUES (?)').run(1); writer.persistNow();
    const before = readFileSync(path);
    const reader = backend === 'sqljs' ? await openReadonlySqlJs(path) : openReadonlyNativeSqlite(path);
    try {
      for (const sql of ['UPDATE fixture SET value = 2 RETURNING value', 'INSERT INTO fixture VALUES (2) RETURNING value',
        'DELETE FROM fixture RETURNING value', 'CREATE TABLE changed(value)', 'PRAGMA query_only = OFF',
        "ATTACH DATABASE ':memory:' AS changed", 'BEGIN', 'SELECT value FROM fixture; UPDATE fixture SET value = 2']) {
        expect(() => reader.all(sql), sql).toThrow();
      }
      expect(reader.all('SELECT value FROM fixture')).toEqual([{ value: 1 }]);
      expect(reader.all('PRAGMA table_xinfo("fixture")')).toEqual([expect.objectContaining({ name: 'value', type: 'INTEGER' })]);
      expect(before.equals(readFileSync(path))).toBe(true);
    } finally { reader.close(); }
  });
});
