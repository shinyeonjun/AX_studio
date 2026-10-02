import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as SqlJsDatabase } from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeDatabase } from '../db-native.js';
import { createSqlJsDatabase } from './sqljs.js';
import type { AppDatabase } from './types.js';

let directory: string;
let db: AppDatabase | undefined;
async function open(backend: 'native' | 'sqljs') {
  directory = mkdtempSync(join(tmpdir(), 'ax-snapshot-guard-'));
  const path = join(directory, 'synthetic.db');
  db = backend === 'native' ? createNativeDatabase(path) : await createSqlJsDatabase(path);
  db.exec('CREATE TABLE synthetic_guard (id INTEGER PRIMARY KEY)');
  db.prepare('INSERT INTO synthetic_guard VALUES (1)').run();
  return { adapter: db, path };
}
function rawSqlJs(adapter: AppDatabase) {
  return (adapter as unknown as { db: SqlJsDatabase }).db;
}
afterEach(() => {
  vi.restoreAllMocks();
  db?.close?.();
  db = undefined;
  vi.useRealTimers();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe.each([false, true])('native prepare-only guard (caller transaction: %s)', caller => {
  it.each([
    'PRAGMA read_uncommitted = ON', 'PRAGMA query_only = ON',
    'PRAGMA main.read_uncommitted(ON)', 'PRAGMA "main"."query_only"(ON)',
    'EXPLAIN PRAGMA query_only = ON', 'EXPLAIN QUERY PLAN PRAGMA read_uncommitted = ON',
    '/* leading */ EXPLAIN /* inner */ PRAGMA query_only = ON',
    'SELECT 1; PRAGMA query_only = ON',
  ])('rejects %s before compilation and keeps settings/ownership', async sql => {
    const { adapter } = await open('native');
    const settings = () => [adapter.prepare('PRAGMA read_uncommitted').get(), adapter.prepare('PRAGMA query_only').get()];
    const before = settings();
    if (caller) {
      adapter.exec('BEGIN');
      adapter.prepare('INSERT INTO synthetic_guard VALUES (2)').run();
    }
    let failure: unknown;
    adapter.readSnapshot(() => {
      try { adapter.prepare(sql); } catch (error) { failure = error; }
      // Deliberately never call run/get/all on the rejected statement.
    });
    expect(settings()).toEqual(before);
    expect(failure).toMatchObject({ message: 'read_snapshot_write_forbidden' });
    if (caller) {
      expect(adapter.prepare('SELECT id FROM synthetic_guard ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
      adapter.exec('ROLLBACK');
    } else {
      adapter.exec('BEGIN');
      adapter.exec('ROLLBACK');
    }
    expect(adapter.prepare('SELECT id FROM synthetic_guard').all()).toEqual([{ id: 1 }]);
  });
});

describe.each(['native', 'sqljs'] as const)('supported snapshot reads (%s)', backend => {
  it('preserves an already-readonly caller setting', async () => {
    const { adapter } = await open(backend);
    adapter.exec('PRAGMA query_only = ON');
    expect(adapter.readSnapshot(() => adapter.prepare('PRAGMA query_only').get())).toEqual({ query_only: 1 });
    expect(adapter.prepare('PRAGMA query_only').get()).toEqual({ query_only: 1 });
    adapter.exec('PRAGMA query_only = OFF');
  });

  it.each([
    'SELECT id FROM synthetic_guard',
    '/* leading */ WITH x AS (SELECT id FROM synthetic_guard) SELECT * FROM x;',
    'EXPLAIN SELECT id FROM synthetic_guard',
    'EXPLAIN /* inner */ QUERY PLAN SELECT id FROM synthetic_guard',
    "SELECT '; PRAGMA query_only = OFF' AS literal",
    "PRAGMA table_info('synthetic_guard')",
    "PRAGMA main.table_info('synthetic_guard')",
    "PRAGMA \"main\".\"table_info\" = 'synthetic_guard'",
  ])('retains %s without writes or caller finalization', async sql => {
    const { adapter } = await open(backend);
    adapter.exec('BEGIN');
    adapter.prepare('INSERT INTO synthetic_guard VALUES (2)').run();
    const before = adapter.prepare('SELECT total_changes() AS count').get();
    expect(adapter.readSnapshot(() => adapter.prepare(sql).all()).length).toBeGreaterThan(0);
    expect(adapter.prepare('SELECT total_changes() AS count').get()).toEqual(before);
    adapter.exec('ROLLBACK');
    expect(adapter.prepare('SELECT id FROM synthetic_guard').all()).toEqual([{ id: 1 }]);
  });

  it('retains execution guards for a statement prepared outside the snapshot', async () => {
    const { adapter } = await open(backend);
    const statement = adapter.prepare('EXPLAIN PRAGMA read_uncommitted = ON');
    adapter.exec('PRAGMA read_uncommitted = OFF');
    adapter.readSnapshot(() => {
      expect(() => statement.all()).toThrow('read_snapshot_write_forbidden');
    });
    expect(adapter.prepare('PRAGMA read_uncommitted').get()).toEqual({ read_uncommitted: 0 });
  });
});

describe('sql.js EXPLAIN bypass and cleanup', () => {
  it.each([false, true])('fails closed if SAVEPOINT acquisition throws after taking effect (caller: %s)', async caller => {
    const { adapter } = await open('sqljs');
    const raw = rawSqlJs(adapter);
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic savepoint acquisition failure');
    if (caller) {
      adapter.exec('BEGIN');
      adapter.prepare('INSERT INTO synthetic_guard VALUES (2)').run();
    }
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'SAVEPOINT ax_read_snapshot') { run(sql, params); throw primary; }
      return run(sql, params);
    });
    const read = vi.fn(() => 42);
    let failure: unknown;
    try { adapter.readSnapshot(read); } catch (error) { failure = error; }
    expect(failure).toBe(primary);
    expect(read).not.toHaveBeenCalled();
    expect(raw.exec('SELECT id FROM synthetic_guard ORDER BY id')[0]?.values).toEqual(caller ? [[1], [2]] : [[1]]);
    expect(() => adapter.prepare('SELECT 1')).toThrow('read_snapshot_cleanup_failed');
  });

  it('blocks EXPLAIN setting compilation before WITH DELETE can mutate the image', async () => {
    const { adapter } = await open('sqljs');
    const raw = rawSqlJs(adapter);
    const failures: unknown[] = [];
    let queryOnly: unknown;
    adapter.readSnapshot(() => {
      try { adapter.prepare('EXPLAIN PRAGMA query_only = OFF').all(); } catch (error) { failures.push(error); }
      queryOnly = raw.exec('PRAGMA query_only')[0]?.values[0]?.[0];
      try { adapter.prepare('WITH victim AS (SELECT id FROM synthetic_guard) DELETE FROM synthetic_guard WHERE id IN (SELECT id FROM victim) RETURNING id').all(); }
      catch (error) { failures.push(error); }
    });
    expect(queryOnly).toBe(1);
    expect(adapter.prepare('SELECT id FROM synthetic_guard').all()).toEqual([{ id: 1 }]);
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ message: 'read_snapshot_write_forbidden' });
    expect(adapter.prepare('PRAGMA query_only').get()).toEqual({ query_only: 0 });
  });

  it.each([false, true])('cleans an acquired savepoint after query_only setup fails (caller: %s)', async caller => {
    const { adapter } = await open('sqljs');
    const raw = rawSqlJs(adapter);
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic query_only setup failure');
    let once = true;
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'PRAGMA query_only = ON' && once) {
        once = false;
        run(sql, params); // Failure after the setting changed still needs restoration.
        throw primary;
      }
      return run(sql, params);
    });
    if (caller) {
      adapter.exec('BEGIN');
      adapter.prepare('INSERT INTO synthetic_guard VALUES (2)').run();
    }
    const read = vi.fn(() => 42);
    let failure: unknown;
    try { adapter.readSnapshot(read); } catch (error) { failure = error; }
    expect(failure).toBe(primary);
    expect(read).not.toHaveBeenCalled();
    expect(adapter.prepare('PRAGMA query_only').get()).toEqual({ query_only: 0 });
    if (caller) expect(adapter.prepare('SELECT id FROM synthetic_guard ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
    else adapter.exec('BEGIN'); // Would fail if the reader left its savepoint open.
    adapter.exec('ROLLBACK');
    expect(adapter.prepare('SELECT id FROM synthetic_guard').all()).toEqual([{ id: 1 }]);
  });

  it('preserves the read exception and fails closed when rollback/restoration fail', async () => {
    vi.useFakeTimers();
    const { adapter, path } = await open('sqljs');
    await vi.advanceTimersByTimeAsync(1000);
    const original = readFileSync(path);
    utimesSync(path, new Date(0), new Date(0));
    const mtime = statSync(path).mtimeMs;
    const raw = rawSqlJs(adapter);
    const run = raw.run.bind(raw);
    const statement = adapter.prepare('INSERT INTO synthetic_guard VALUES (3)');
    adapter.exec('BEGIN');
    adapter.prepare('INSERT INTO synthetic_guard VALUES (2)').run();
    const primary = new Error('synthetic read failure');
    const cleanup = new Error('synthetic cleanup failure');
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'ROLLBACK TO ax_read_snapshot' || sql === 'PRAGMA query_only = OFF') throw cleanup;
      return run(sql, params);
    });
    let failure: unknown;
    try { adapter.readSnapshot(() => { throw primary; }); } catch (error) { failure = error; }
    expect(failure).toBe(primary);
    expect(raw.exec('SELECT id FROM synthetic_guard ORDER BY id')[0]?.values).toEqual([[1], [2]]);
    expect(() => adapter.exec('COMMIT')).toThrow('read_snapshot_cleanup_failed');
    expect(() => statement.run()).toThrow('read_snapshot_cleanup_failed');
    expect(() => adapter.prepare('SELECT 1').get()).toThrow('read_snapshot_cleanup_failed');
    expect(() => adapter.readSnapshot(() => 42)).toThrow('read_snapshot_cleanup_failed');
    await vi.advanceTimersByTimeAsync(1000);
    expect(statSync(path).mtimeMs).toBe(mtime);
    expect(readFileSync(path).equals(original)).toBe(true);
    adapter.close?.(); // Discard the unsafe image; never export it on close.
    db = undefined;
    expect(readFileSync(path).equals(original)).toBe(true);
  });

  it('fails closed when restoration fails after a successful read', async () => {
    const { adapter } = await open('sqljs');
    const raw = rawSqlJs(adapter);
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic restoration failure');
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'PRAGMA query_only = OFF') throw primary;
      return run(sql, params);
    });
    let failure: unknown;
    try { adapter.readSnapshot(() => 42); } catch (error) { failure = error; }
    expect(failure).toBe(primary);
    expect(() => adapter.prepare('SELECT 1')).toThrow('read_snapshot_cleanup_failed');
  });

  it('retains caller work when a RELEASE failure can be cleaned up', async () => {
    const { adapter } = await open('sqljs');
    const raw = rawSqlJs(adapter);
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic release failure');
    let once = true;
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'RELEASE ax_read_snapshot' && once) { once = false; throw primary; }
      return run(sql, params);
    });
    adapter.exec('BEGIN');
    adapter.prepare('INSERT INTO synthetic_guard VALUES (2)').run();
    let failure: unknown;
    try { adapter.readSnapshot(() => 42); } catch (error) { failure = error; }
    expect(failure).toBe(primary);
    expect(adapter.prepare('SELECT id FROM synthetic_guard ORDER BY id').all()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(adapter.prepare('PRAGMA query_only').get()).toEqual({ query_only: 0 });
    adapter.exec('ROLLBACK');
    expect(adapter.prepare('SELECT id FROM synthetic_guard').all()).toEqual([{ id: 1 }]);
  });
});
