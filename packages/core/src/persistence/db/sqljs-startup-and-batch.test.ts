import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database as RawDatabase } from 'sql.js';
import type { AppDatabase } from './types.js';
import { createSqlJsDatabase, openReadonlySqlJs } from './sqljs.js';

type TestDatabase = AppDatabase & { persistNow(): void; db: RawDatabase; persist(): void };

describe('sql.js startup and partially executed writes', () => {
  let root: string;
  let file: string;
  let adapter: TestDatabase | undefined;
  let leaked: RawDatabase | undefined;

  beforeEach(async () => {
    vi.useFakeTimers();
    root = mkdtempSync(join(tmpdir(), 'ax-sqljs-boundary-'));
    file = join(root, 'synthetic.sqlite');
    adapter = await createSqlJsDatabase(file) as TestDatabase;
    adapter.exec('CREATE TABLE synthetic_owner (id INTEGER PRIMARY KEY)');
    adapter.prepare('INSERT INTO synthetic_owner VALUES (1)').run();
    adapter.persistNow();
    expect(vi.getTimerCount()).toBe(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    try { adapter?.close?.(); }
    finally {
      try { leaked?.close(); }
      finally {
        adapter = undefined;
        leaked = undefined;
        vi.useRealTimers();
        if (dirname(resolve(root)) !== resolve(tmpdir()) || !basename(root).startsWith('ax-sqljs-boundary-')) {
          throw new Error('unexpected_synthetic_cleanup_target');
        }
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
  function rows() {
    return adapter!.prepare('SELECT id FROM synthetic_owner ORDER BY id').all();
  }
  async function diskRows() {
    const disk = await openReadonlySqlJs(file);
    try { return disk.all('SELECT id FROM synthetic_owner ORDER BY id'); }
    finally { disk.close(); }
  }
  function caught(operation: () => void): unknown {
    try { operation(); return undefined; } catch (error) { return error; }
  }

  it.each(['probe', 'export', 'restore', 'initial-setting', 'attached-setting'] as const)(
    'retains the startup %s error over disposal failure and cancels timers without writing',
    async fault => {
      const prototype = Object.getPrototypeOf(adapter!.db) as RawDatabase;
      const run = prototype.run;
      const exportDatabase = prototype.export;
      adapter!.close!();
      adapter = undefined;
      const before = readFileSync(file);
      const primary = new Error('synthetic initial '+fault+' failure');
      const secondary = new Error('synthetic factory disposal failure');
      let exported = false;
      let settings = 0;
      vi.spyOn(prototype, 'run').mockImplementation(function(this: RawDatabase, sql, params) {
        if (sql === 'PRAGMA foreign_keys = ON') settings += 1;
        if ((fault === 'probe' && sql === 'BEGIN DEFERRED')
          || (fault === 'restore' && exported && sql === 'PRAGMA foreign_keys = ON')
          || (fault === 'initial-setting' && sql === 'PRAGMA foreign_keys = ON' && settings === 1)
          || (fault === 'attached-setting' && sql === 'PRAGMA foreign_keys = ON' && settings === 2)) {
          leaked = this;
          throw primary;
        }
        return run.call(this, sql, params);
      });
      vi.spyOn(prototype, 'export').mockImplementation(function(this: RawDatabase) {
        if (fault === 'export') { leaked = this; throw primary; }
        exported = true;
        return exportDatabase.call(this);
      });
      const close = vi.spyOn(prototype, 'close').mockImplementation(() => { throw secondary; });
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      let failure: unknown;
      try { await createSqlJsDatabase(file); } catch (error) { failure = error; }
      expect(leaked).toBeDefined();
      expect(failure).toBe(primary);
      expect(close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(2500);
      expect(errors).not.toHaveBeenCalled();
      expect(readFileSync(file)).toEqual(before);
    },
  );

  it.each([
    { start: 'BEGIN', finish: 'COMMIT' },
    { start: 'SAVEPOINT synthetic_caller', finish: 'RELEASE synthetic_caller' },
  ])('persists a committed prefix after a failed compound $start batch with no earlier timer', async ({ start, finish }) => {
    const before = readFileSync(file);
    const failure = caught(() => adapter!.exec(start+'; INSERT INTO synthetic_owner VALUES (2); '+finish+'; SELECT * FROM missing_synthetic_table'));
    expect(failure).toMatchObject({ message: 'no such table: missing_synthetic_table' });
    expect(rows()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(readFileSync(file)).toEqual(before);
    await vi.advanceTimersByTimeAsync(1);
    expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const outer of ['BEGIN', 'SAVEPOINT synthetic_outer']) {
    it.each(['RELEASE synthetic_inner', 'ROLLBACK TO synthetic_inner'])(
      'keeps pending work and the surviving '+outer+' owner after a failed compound batch (%s)',
      async inner => {
        const before = readFileSync(file);
        const failure = caught(() => adapter!.exec(outer+'; INSERT INTO synthetic_owner VALUES (2); SAVEPOINT synthetic_inner; INSERT INTO synthetic_owner VALUES (3); '+inner+'; SELECT * FROM missing_synthetic_table'));
        const expected = inner.startsWith('ROLLBACK') ? [{ id: 1 }, { id: 2 }] : [{ id: 1 }, { id: 2 }, { id: 3 }];
        expect(failure).toMatchObject({ message: 'no such table: missing_synthetic_table' });
        expect(rows()).toEqual(expected);
        const exports = vi.spyOn(adapter!.db, 'export');
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        await vi.advanceTimersByTimeAsync(2500);
        expect(exports).not.toHaveBeenCalled();
        expect(errors).not.toHaveBeenCalled();
        expect(readFileSync(file)).toEqual(before);
        const pending = vi.getTimerCount();
        expect(pending).toBeGreaterThan(0);
        expect(pending).toBeLessThanOrEqual(2);
        expect(() => adapter!.persistNow()).toThrow('persistence_transaction_open');
        expect(vi.getTimerCount()).toBe(pending);
        expect(adapter!.readSnapshot(rows)).toEqual(expected);
        adapter!.prepare(outer === 'BEGIN' ? 'COMMIT' : 'RELEASE synthetic_outer').get();
        await vi.advanceTimersByTimeAsync(250);
        expect(await diskRows()).toEqual(expected);
        expect(vi.getTimerCount()).toBe(0);
      },
    );
  }

  it.each(['BEGIN', 'SAVEPOINT synthetic_caller'])('persists autocommitted work after a compound %s rollback and later SQL error', async start => {
    const failure = caught(() => adapter!.exec(start+'; INSERT INTO synthetic_owner VALUES (2); ROLLBACK; INSERT INTO synthetic_owner VALUES (3); SELECT * FROM missing_synthetic_table'));
    expect(failure).toMatchObject({ message: 'no such table: missing_synthetic_table' });
    expect(rows()).toEqual([{ id: 1 }, { id: 3 }]);
    await vi.advanceTimersByTimeAsync(250);
    expect(await diskRows()).toEqual([{ id: 1 }, { id: 3 }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['exec', 'run'] as const)('persists partial INSERT OR FAIL effects from %s while retaining its exception', async method => {
    const sql = 'INSERT OR FAIL INTO synthetic_owner VALUES (2), (1)';
    const failure = caught(() => {
      if (method === 'exec') adapter!.exec(sql);
      else adapter!.prepare(sql).run();
    });
    expect(failure).toMatchObject({ message: 'UNIQUE constraint failed: synthetic_owner.id' });
    expect(rows()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the original SQL failure when scheduling also throws after a committed prefix', () => {
    const raw = adapter!.db;
    const run = raw.run.bind(raw);
    let primary: unknown;
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      try { return run(sql, params); } catch (error) { primary = error; throw error; }
    });
    const secondary = new Error('synthetic persistence scheduling failure');
    const scheduled = vi.spyOn(adapter!, 'persist').mockImplementation(() => { throw secondary; });
    const actual = caught(() => adapter!.exec('BEGIN; INSERT INTO synthetic_owner VALUES (2); COMMIT; SELECT * FROM missing_synthetic_table'));
    expect(primary).toMatchObject({ message: 'no such table: missing_synthetic_table' });
    expect(actual).toBe(primary);
    expect(scheduled).toHaveBeenCalledOnce();
    expect(rows()).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

