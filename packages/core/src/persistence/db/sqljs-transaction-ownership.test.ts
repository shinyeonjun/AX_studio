import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database as RawDatabase } from 'sql.js';
import type { AppDatabase } from './types.js';
import { createSqlJsDatabase, openReadonlySqlJs } from './sqljs.js';

type PersistableDatabase = AppDatabase & { persistNow(): void; db: RawDatabase };

describe('sql.js caller transaction persistence ownership', () => {
  let root: string | undefined;
  let file: string;
  let db: PersistableDatabase | undefined;
  async function open() {
    root = mkdtempSync(join(tmpdir(), 'ax-sqljs-owner-'));
    file = join(root, 'synthetic.sqlite');
    db = await createSqlJsDatabase(file) as PersistableDatabase;
    db.exec('CREATE TABLE synthetic_owner (id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO synthetic_owner VALUES (1)').run();
    db.persistNow();
    return db;
  }
  function rows() {
    return db!.prepare('SELECT id FROM synthetic_owner ORDER BY id').all();
  }
  function blocked() {
    const bytes = readFileSync(file);
    const originalRows = rows();
    const settings = db!.db.exec('PRAGMA foreign_keys; PRAGMA query_only; SELECT last_insert_rowid(), changes()');
    const exports = vi.spyOn(db!.db, 'export');
    try {
      expect(() => db!.persistNow()).toThrow('persistence_transaction_open');
      expect(exports).not.toHaveBeenCalled();
      expect(rows()).toEqual(originalRows);
      expect(readFileSync(file)).toEqual(bytes);
      expect(db!.db.exec('PRAGMA foreign_keys; PRAGMA query_only; SELECT last_insert_rowid(), changes()')).toEqual(settings);
    } finally { exports.mockRestore(); }
  }
  async function diskRows() {
    const disk = await openReadonlySqlJs(file);
    try { return disk.all('SELECT id FROM synthetic_owner ORDER BY id'); }
    finally { disk.close(); }
  }
  afterEach(() => {
    vi.restoreAllMocks();
    try { db?.close?.(); }
    finally {
      db = undefined;
      vi.useRealTimers();
      if (root) rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  it.each(['BEGIN', 'SAVEPOINT synthetic_caller'])('rejects a barrier after a joined read snapshot (%s)', async control => {
    const adapter = await open();
    adapter.exec(control);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    expect(adapter.readSnapshot(() => adapter.readSnapshot(rows))).toEqual([{ id: 1 }, { id: 2 }]);
    blocked();
    if (control.startsWith('SAVEPOINT')) {
      adapter.exec('ROLLBACK TO synthetic_caller');
      adapter.exec('RELEASE synthetic_caller');
    } else adapter.exec('ROLLBACK');
    expect(rows()).toEqual([{ id: 1 }]);
  });

  it.each(['exec', 'run', 'all', 'get'] as const)('detects a caller savepoint opened through %s', async method => {
    const adapter = await open();
    const control = '/* synthetic ownership */ SAVEPOINT "caller with space"';
    if (method === 'exec') adapter.exec(control);
    else adapter.prepare(control)[method]();
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    blocked();
    adapter.exec('ROLLBACK TO "caller with space"');
    adapter.exec('RELEASE "caller with space"');
    expect(rows()).toEqual([{ id: 1 }]);
  });

  it('retains the outer savepoint after releasing a nested savepoint, then persists the caller commit', async () => {
    const adapter = await open();
    adapter.exec('SAVEPOINT synthetic_outer; INSERT INTO synthetic_owner VALUES (2); SAVEPOINT synthetic_inner');
    adapter.prepare('INSERT INTO synthetic_owner VALUES (3)').run();
    adapter.exec('RELEASE synthetic_inner');
    blocked();
    expect(rows()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    adapter.exec('RELEASE synthetic_outer');
    adapter.persistNow();
    expect(await diskRows()).toEqual(rows());
  });

  it('does not mistake ROLLBACK TO for a caller-wide rollback under BEGIN', async () => {
    const adapter = await open();
    adapter.exec('BEGIN');
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    adapter.exec('SAVEPOINT synthetic_inner');
    adapter.prepare('INSERT INTO synthetic_owner VALUES (3)').run();
    adapter.exec('ROLLBACK TO synthetic_inner');
    expect(rows()).toEqual([{ id: 1 }, { id: 2 }]);
    blocked();
    adapter.exec('RELEASE synthetic_inner');
    blocked();
    adapter.exec('END');
    adapter.persistNow();
    expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it('retains SQLite duplicate-name and ROLLBACK TO semantics', async () => {
    const adapter = await open();
    adapter.exec('SAVEPOINT synthetic_same');
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    adapter.exec('SAVEPOINT synthetic_same');
    adapter.prepare('INSERT INTO synthetic_owner VALUES (3)').run();
    adapter.exec('ROLLBACK TO SAVEPOINT synthetic_same');
    expect(rows()).toEqual([{ id: 1 }, { id: 2 }]);
    adapter.exec('RELEASE SAVEPOINT synthetic_same');
    blocked();
    adapter.exec('ROLLBACK TO synthetic_same');
    adapter.exec('RELEASE synthetic_same');
    adapter.persistNow();
    expect(await diskRows()).toEqual([{ id: 1 }]);
  });

  it('retains ownership after failed control statements and a deferred-foreign-key release failure', async () => {
    const adapter = await open();
    adapter.exec('CREATE TABLE synthetic_reference (owner_id INTEGER REFERENCES synthetic_owner(id) DEFERRABLE INITIALLY DEFERRED)');
    adapter.persistNow();
    adapter.exec('SAVEPOINT synthetic_caller');
    adapter.prepare('INSERT INTO synthetic_reference VALUES (99)').run();
    expect(() => adapter.exec('RELEASE missing_synthetic_savepoint')).toThrow('no such savepoint');
    expect(() => adapter.exec('RELEASE synthetic_caller')).toThrow('FOREIGN KEY constraint failed');
    blocked();
    adapter.exec('ROLLBACK TO synthetic_caller');
    adapter.exec('RELEASE synthetic_caller');
    expect(adapter.prepare('SELECT * FROM synthetic_reference').all()).toEqual([]);
  });

  it.each(['BEGIN', 'SAVEPOINT synthetic_caller'])('fences both pending timer deadlines without exporting caller work (%s)', async control => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run(); // Already committed, pending export.
    adapter.exec(control);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (3)').run();
    const exports = vi.spyOn(adapter.db, 'export');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(1000);
    expect(exports).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect(readFileSync(file)).toEqual(before);
    expect(rows()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    if (control.startsWith('SAVEPOINT')) adapter.exec('RELEASE synthetic_caller');
    else adapter.exec('COMMIT');
    await vi.advanceTimersByTimeAsync(250);
    expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it.each(['BEGIN', 'SAVEPOINT synthetic_caller'])('rolls back the caller before explicit-close export (%s)', async control => {
    const adapter = await open();
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run(); // Committed before caller ownership.
    adapter.exec(control);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (3)').run();
    const controls = vi.spyOn(adapter.db, 'run');
    const exports = vi.spyOn(adapter.db, 'export');
    adapter.close!();
    db = undefined;
    const rollback = controls.mock.calls.findIndex(([sql]) => sql === 'ROLLBACK');
    expect(rollback).toBeGreaterThanOrEqual(0);
    expect(controls.mock.invocationCallOrder[rollback]).toBeLessThan(exports.mock.invocationCallOrder[0]!);
    expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }]);
  });

  const completions = [
    { start: 'BEGIN', finish: 'COMMIT', committed: true },
    { start: 'BEGIN', finish: 'END', committed: true },
    { start: 'BEGIN', finish: 'ROLLBACK', committed: false },
    { start: 'SAVEPOINT synthetic_caller', finish: 'RELEASE synthetic_caller', committed: true },
    { start: 'SAVEPOINT synthetic_caller', finish: 'ROLLBACK', committed: false },
  ];
  for (const method of ['all', 'get'] as const) {
    it.each(completions)('persists work after prepared '+method+' completion without an existing timer ($start -> $finish)', async ({ start, finish, committed }) => {
      vi.useFakeTimers();
      const adapter = await open();
      expect(vi.getTimerCount()).toBe(0);
      adapter.exec(start);
      adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
      await vi.advanceTimersByTimeAsync(1000);
      const pending = vi.getTimerCount();
      expect(pending).toBeGreaterThan(0);
      expect(pending).toBeLessThanOrEqual(2);
      blocked();
      expect(vi.getTimerCount()).toBe(pending);
      adapter.prepare(finish)[method](); // No new write or exec rescheduling.
      await vi.advanceTimersByTimeAsync(250);
      expect(await diskRows()).toEqual(committed ? [{ id: 1 }, { id: 2 }] : [{ id: 1 }]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each(completions)('retains earlier pending writes and timer slots through prepared '+method+' completion ($start -> $finish)', async ({ start, finish, committed }) => {
      vi.useFakeTimers();
      const adapter = await open();
      const before = readFileSync(file);
      adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
      adapter.exec(start);
      adapter.prepare('INSERT INTO synthetic_owner VALUES (3)').run();
      const exports = vi.spyOn(adapter.db, 'export');
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      for (let tick = 0; tick < 20; tick += 1) {
        await vi.advanceTimersByTimeAsync(250);
        expect(vi.getTimerCount()).toBeGreaterThan(0);
        expect(vi.getTimerCount()).toBeLessThanOrEqual(2);
      }
      expect(exports).not.toHaveBeenCalled();
      expect(errors).not.toHaveBeenCalled();
      expect(readFileSync(file)).toEqual(before);
      const pending = vi.getTimerCount();
      blocked();
      expect(vi.getTimerCount()).toBe(pending);
      expect(adapter.readSnapshot(rows)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(vi.getTimerCount()).toBe(pending);
      adapter.prepare(finish)[method]();
      await vi.advanceTimersByTimeAsync(250);
      expect(await diskRows()).toEqual(committed ? [{ id: 1 }, { id: 2 }, { id: 3 }] : [{ id: 1 }, { id: 2 }]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('retains the savepoint after prepared '+method+' ROLLBACK TO, then persists prepared RELEASE', async () => {
      vi.useFakeTimers();
      const adapter = await open();
      adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
      adapter.exec('SAVEPOINT synthetic_caller');
      adapter.prepare('INSERT INTO synthetic_owner VALUES (3)').run();
      await vi.advanceTimersByTimeAsync(1000);
      adapter.prepare('ROLLBACK TO synthetic_caller')[method]();
      expect(rows()).toEqual([{ id: 1 }, { id: 2 }]);
      blocked();
      adapter.prepare('RELEASE synthetic_caller')[method]();
      await vi.advanceTimersByTimeAsync(250);
      expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }]);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('closes an idle image after prepared '+method+' COMMIT without stale-counter rollback', async () => {
      vi.useFakeTimers();
      const adapter = await open();
      adapter.exec('BEGIN');
      adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
      adapter.prepare('COMMIT')[method]();
      expect(() => adapter.close!()).not.toThrow();
      db = undefined;
      expect(vi.getTimerCount()).toBe(0);
      expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }]);
    });
  }

  function caught(operation: () => void): unknown {
    try { operation(); return undefined; } catch (error) { return error; }
  }
  function inaccessible(adapter: PersistableDatabase, reason: string) {
    expect(() => adapter.exec('COMMIT')).toThrow(reason);
    expect(() => adapter.prepare('SELECT 1')).toThrow(reason);
    expect(() => adapter.readSnapshot(() => 42)).toThrow(reason);
    expect(() => adapter.persistNow()).toThrow(reason);
  }

  it.each([
    { control: 'BEGIN DEFERRED', effect: false },
    { control: 'BEGIN DEFERRED', effect: true },
    { control: 'ROLLBACK', effect: false },
    { control: 'ROLLBACK', effect: true },
  ])('preserves the primary error and fails closed after uncertain probe $control (effect: $effect)', async ({ control, effect }) => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    const selected = adapter.prepare('SELECT id FROM synthetic_owner ORDER BY id');
    const write = adapter.prepare('INSERT INTO synthetic_owner VALUES (3)');
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    const raw = adapter.db;
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic ownership probe failure');
    const controls = vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === control) {
        if (effect) run(sql, params);
        throw primary;
      }
      return run(sql, params);
    });
    const exports = vi.spyOn(raw, 'export');
    expect(caught(() => adapter.persistNow())).toBe(primary);
    expect(raw.exec('SELECT id FROM synthetic_owner ORDER BY id')[0]?.values).toEqual([[1], [2]]);
    inaccessible(adapter, 'persistence_transaction_state_unknown');
    expect(() => selected.all()).toThrow('persistence_transaction_state_unknown');
    expect(() => selected.get()).toThrow('persistence_transaction_state_unknown');
    expect(() => write.run()).toThrow('persistence_transaction_state_unknown');
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(exports).not.toHaveBeenCalled();
    const calls = controls.mock.calls.length;
    adapter.close!();
    db = undefined;
    expect(controls.mock.calls).toHaveLength(calls); // Disposal performs no further SQL control.
    expect(readFileSync(file)).toEqual(before);
  });

  it('does not roll back an existing caller when probe acquisition is uncertain', async () => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    adapter.exec('SAVEPOINT synthetic_caller');
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    const raw = adapter.db;
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic acquisition failure with caller');
    const controls = vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'BEGIN DEFERRED') throw primary;
      return run(sql, params);
    });
    const exports = vi.spyOn(raw, 'export');
    expect(caught(() => adapter.persistNow())).toBe(primary);
    expect(raw.exec('SELECT id FROM synthetic_owner ORDER BY id')[0]?.values).toEqual([[1], [2]]);
    expect(() => run('BEGIN')).toThrow('cannot start a transaction within a transaction');
    inaccessible(adapter, 'persistence_transaction_state_unknown');
    adapter.close!();
    db = undefined;
    expect(controls.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(false);
    expect(exports).not.toHaveBeenCalled();
    expect(readFileSync(file)).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs a deferred ownership failure once, cancels callbacks and disposes without export', async () => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    const raw = adapter.db;
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic deferred ownership failure');
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'BEGIN DEFERRED') throw primary;
      return run(sql, params);
    });
    const exports = vi.spyOn(raw, 'export');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(3000);
    expect(errors).toHaveBeenCalledExactlyOnceWith('[sql.js] deferred database persistence failed:', primary);
    expect(vi.getTimerCount()).toBe(0);
    inaccessible(adapter, 'persistence_transaction_state_unknown');
    adapter.close!();
    db = undefined;
    expect(exports).not.toHaveBeenCalled();
    expect(readFileSync(file)).toEqual(before);
  });

  it.each([
    { control: 'BEGIN', effect: false },
    { control: 'BEGIN', effect: true },
    { control: 'SAVEPOINT synthetic_caller', effect: false },
    { control: 'SAVEPOINT synthetic_caller', effect: true },
  ])('preserves failed caller-close rollback over secondary close failure ($control, effect: $effect)', async ({ control, effect }) => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    adapter.exec(control);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (3)').run();
    const raw = adapter.db;
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic caller-close rollback failure');
    const secondary = new Error('synthetic secondary close failure');
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'ROLLBACK') {
        if (effect) run(sql, params);
        throw primary;
      }
      return run(sql, params);
    });
    const exports = vi.spyOn(raw, 'export');
    const close = vi.spyOn(raw, 'close').mockImplementation(() => { throw secondary; });
    expect(caught(() => adapter.close!())).toBe(primary);
    expect(raw.exec('SELECT id FROM synthetic_owner ORDER BY id')[0]?.values).toEqual(effect ? [[1], [2]] : [[1], [2], [3]]);
    expect(exports).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledOnce();
    inaccessible(adapter, 'persistence_transaction_state_unknown');
    expect(vi.getTimerCount()).toBe(0);
    close.mockRestore();
    adapter.close!();
    db = undefined;
    expect(exports).not.toHaveBeenCalled();
    expect(readFileSync(file)).toEqual(before);
  });

  it.each([false, true])('preserves export failure over restoration and close failures (restoration: %s)', async restoration => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    const raw = adapter.db;
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic export failure');
    const secondary = new Error('synthetic restoration failure');
    const tertiary = new Error('synthetic secondary close failure');
    const exports = vi.spyOn(raw, 'export').mockImplementation(() => { throw primary; });
    if (restoration) vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'PRAGMA foreign_keys = ON') throw secondary;
      return run(sql, params);
    });
    const close = vi.spyOn(raw, 'close').mockImplementation(() => { throw tertiary; });
    expect(caught(() => adapter.close!())).toBe(primary);
    expect(exports).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(readFileSync(file)).toEqual(before);
    expect(vi.getTimerCount()).toBe(0);
    inaccessible(adapter, restoration ? 'persistence_connection_restore_failed' : 'persistence_close_failed');
    close.mockRestore();
    adapter.close!(); // Failed disposal must not retry an export.
    db = undefined;
    expect(exports).toHaveBeenCalledOnce();
    expect(readFileSync(file)).toEqual(before);
  });

  it('preserves explicit export failure over restoration failure and retains the prior file', async () => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    const raw = adapter.db;
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic explicit export failure');
    const secondary = new Error('synthetic export restoration failure');
    const exports = vi.spyOn(raw, 'export').mockImplementation(() => { throw primary; });
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'PRAGMA foreign_keys = ON') throw secondary;
      return run(sql, params);
    });
    expect(caught(() => adapter.persistNow())).toBe(primary);
    inaccessible(adapter, 'persistence_connection_restore_failed');
    expect(raw.exec('SELECT id FROM synthetic_owner ORDER BY id')[0]?.values).toEqual([[1], [2]]);
    expect(vi.getTimerCount()).toBe(0);
    adapter.close!();
    db = undefined;
    expect(exports).toHaveBeenCalledOnce();
    expect(readFileSync(file)).toEqual(before);
  });

  it('fails closed after restoration fails following a successful export, without writing the file', async () => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    const raw = adapter.db;
    const run = raw.run.bind(raw);
    const primary = new Error('synthetic post-export restoration failure');
    const exports = vi.spyOn(raw, 'export');
    vi.spyOn(raw, 'run').mockImplementation((sql, params) => {
      if (sql === 'PRAGMA foreign_keys = ON') throw primary;
      return run(sql, params);
    });
    expect(caught(() => adapter.persistNow())).toBe(primary);
    inaccessible(adapter, 'persistence_connection_restore_failed');
    expect(vi.getTimerCount()).toBe(0);
    adapter.close!();
    db = undefined;
    expect(exports).toHaveBeenCalledOnce();
    expect(readFileSync(file)).toEqual(before);
  });

  it('propagates a close-only failure after committed persistence, then forbids further normal access', async () => {
    vi.useFakeTimers();
    const adapter = await open();
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    const raw = adapter.db;
    const primary = new Error('synthetic close-only failure');
    const close = vi.spyOn(raw, 'close').mockImplementation(() => { throw primary; });
    expect(caught(() => adapter.close!())).toBe(primary);
    expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }]); // Flush succeeded; disposal did not.
    inaccessible(adapter, 'persistence_close_failed');
    expect(vi.getTimerCount()).toBe(0);
    close.mockRestore();
    adapter.close!();
    db = undefined;
  });

  it.each([false, true])('can retry an export error when connection restoration succeeds (effect: %s)', async effect => {
    vi.useFakeTimers();
    const adapter = await open();
    const before = readFileSync(file);
    adapter.prepare('INSERT INTO synthetic_owner VALUES (2)').run();
    const raw = adapter.db;
    const originalExport = raw.export.bind(raw);
    const primary = new Error('synthetic recoverable export failure');
    const exports = vi.spyOn(raw, 'export').mockImplementation(() => {
      if (effect) originalExport();
      throw primary;
    });
    expect(caught(() => adapter.persistNow())).toBe(primary);
    expect(readFileSync(file)).toEqual(before);
    expect(rows()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(adapter.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    exports.mockRestore();
    adapter.persistNow();
    expect(await diskRows()).toEqual([{ id: 1 }, { id: 2 }]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
