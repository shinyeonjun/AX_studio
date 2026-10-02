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
    const exports = vi.spyOn(db!.db, 'export');
    try {
      expect(() => db!.persistNow()).toThrow('persistence_transaction_open');
      expect(exports).not.toHaveBeenCalled();
      expect(rows()).toEqual(originalRows);
      expect(readFileSync(file)).toEqual(bytes);
    } finally { exports.mockRestore(); }
  }
  async function diskRows() {
    const disk = await openReadonlySqlJs(file);
    try { return disk.all('SELECT id FROM synthetic_owner ORDER BY id'); }
    finally { disk.close(); }
  }
  afterEach(() => {
    try { db?.close?.(); }
    finally {
      db = undefined;
      vi.restoreAllMocks();
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
});

