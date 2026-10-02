import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeDatabase } from '../db-native.js';
import type { AppDatabase } from './types.js';
import { createSqlJsDatabase, openReadonlySqlJs } from './sqljs.js';

// Keeps this regression runnable against the pre-implementation adapter.
function snapshot<T>(db: AppDatabase, read: () => T): T {
  const adapter = db as AppDatabase & { readSnapshot?: <R>(read: () => R) => R };
  expect(adapter).toHaveProperty('readSnapshot', expect.any(Function));
  return adapter.readSnapshot!(read);
}

describe.each(['native', 'sqljs'] as const)('backend-owned read snapshot (%s)', backend => {
  let directory: string;
  let db: AppDatabase;
  async function open() {
    directory = mkdtempSync(join(tmpdir(), 'ax-read-snapshot-'));
    const path = join(directory, 'synthetic.db');
    db = backend === 'native' ? createNativeDatabase(path) : await createSqlJsDatabase(path);
    db.exec('CREATE TABLE synthetic_snapshot (id INTEGER PRIMARY KEY)');
    db.prepare('INSERT INTO synthetic_snapshot VALUES (?)').run(1);
    return path;
  }
  afterEach(() => {
    db?.close?.();
    vi.useRealTimers();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('releases owned snapshots after successful, missing-row and failing reads', async () => {
    await open();
    expect(snapshot(db, () => db.prepare('SELECT id FROM synthetic_snapshot').get())).toEqual({ id: 1 });
    expect(snapshot(db, () => db.prepare('SELECT id FROM synthetic_snapshot WHERE id = 99').get())).toBeUndefined();
    expect(() => snapshot(db, () => db.prepare('SELECT * FROM missing_synthetic_table').get())).toThrow();
    db.exec('BEGIN');
    db.prepare('INSERT INTO synthetic_snapshot VALUES (?)').run(2);
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT id FROM synthetic_snapshot').all()).toEqual([{ id: 1 }]);
  });

  it('retains the caller transaction and its writes on success and error, including nesting', async () => {
    await open();
    db.exec('BEGIN');
    db.prepare('INSERT INTO synthetic_snapshot VALUES (?)').run(2);
    expect(snapshot(db, () => snapshot(db, () => db.prepare('SELECT COUNT(*) AS count FROM synthetic_snapshot').get())))
      .toEqual({ count: 2 });
    expect(() => snapshot(db, () => { throw new Error('synthetic reader failure'); })).toThrow('synthetic reader failure');
    db.prepare('INSERT INTO synthetic_snapshot VALUES (?)').run(3);
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT id FROM synthetic_snapshot').all()).toEqual([{ id: 1 }]);
  });

  it('retains a caller savepoint without releasing or rolling it back', async () => {
    await open();
    db.exec('SAVEPOINT synthetic_caller');
    db.prepare('INSERT INTO synthetic_snapshot VALUES (?)').run(2);
    expect(snapshot(db, () => db.prepare('SELECT COUNT(*) AS count FROM synthetic_snapshot').get())).toEqual({ count: 2 });
    expect(() => snapshot(db, () => { throw new Error('synthetic error'); })).toThrow('synthetic error');
    db.exec('ROLLBACK TO synthetic_caller');
    db.exec('RELEASE synthetic_caller');
    expect(db.prepare('SELECT id FROM synthetic_snapshot').all()).toEqual([{ id: 1 }]);
  });

  it('rejects callback mutations, transaction control and closing without losing caller work', async () => {
    await open();
    const insert = db.prepare('INSERT INTO synthetic_snapshot VALUES (?)');
    db.exec('BEGIN');
    insert.run(2);
    snapshot(db, () => {
      expect(() => insert.run(3)).toThrow();
      expect(() => db.prepare('DELETE FROM synthetic_snapshot RETURNING id').all()).toThrow();
      expect(() => db.exec('COMMIT')).toThrow();
      expect(() => db.prepare('COMMIT').get()).toThrow();
      expect(() => db.close?.()).toThrow();
      expect(db.prepare('SELECT COUNT(*) AS count FROM synthetic_snapshot').get()).toEqual({ count: 2 });
    });
    db.exec('ROLLBACK');
    expect(db.prepare('SELECT id FROM synthetic_snapshot').all()).toEqual([{ id: 1 }]);
  });
});

describe('sql.js image and persistence ownership', () => {
  let directory: string;
  let db: AppDatabase | undefined;
  afterEach(() => {
    db?.close?.();
    db = undefined;
    vi.useRealTimers();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('does not export on a read, an error or a joined caller transaction', async () => {
    vi.useFakeTimers();
    directory = mkdtempSync(join(tmpdir(), 'ax-sqljs-read-'));
    const path = join(directory, 'synthetic.db');
    db = await createSqlJsDatabase(path);
    db.exec('CREATE TABLE synthetic_snapshot (id INTEGER PRIMARY KEY)');
    await vi.advanceTimersByTimeAsync(1000);
    const original = readFileSync(path);
    utimesSync(path, new Date(0), new Date(0));
    const mtime = statSync(path).mtimeMs;
    snapshot(db, () => db!.prepare('SELECT * FROM synthetic_snapshot').all());
    expect(() => snapshot(db!, () => { throw new Error('synthetic error'); })).toThrow('synthetic error');
    await vi.advanceTimersByTimeAsync(1000);
    expect(statSync(path).mtimeMs).toBe(mtime);
    expect(readFileSync(path).equals(original)).toBe(true);
    db.exec('BEGIN');
    db.prepare('INSERT INTO synthetic_snapshot VALUES (1)').run();
    snapshot(db, () => db!.prepare('SELECT * FROM synthetic_snapshot').all());
    await vi.advanceTimersByTimeAsync(1000);
    expect(statSync(path).mtimeMs).toBe(mtime);
    db.exec('ROLLBACK');
  });

  it('keeps the existing writer persistence timer and caller commit ownership', async () => {
    vi.useFakeTimers();
    directory = mkdtempSync(join(tmpdir(), 'ax-sqljs-timer-'));
    const path = join(directory, 'synthetic.db');
    db = await createSqlJsDatabase(path);
    db.exec('CREATE TABLE synthetic_snapshot (id INTEGER PRIMARY KEY)');
    await vi.advanceTimersByTimeAsync(1000);
    const original = readFileSync(path);
    db.prepare('INSERT INTO synthetic_snapshot VALUES (1)').run();
    snapshot(db, () => db!.prepare('SELECT * FROM synthetic_snapshot').all());
    await vi.advanceTimersByTimeAsync(249);
    expect(readFileSync(path).equals(original)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(readFileSync(path).equals(original)).toBe(false);
    db.exec('BEGIN');
    db.prepare('INSERT INTO synthetic_snapshot VALUES (2)').run();
    snapshot(db, () => db!.prepare('SELECT * FROM synthetic_snapshot').all());
    const readonlyBefore = await openReadonlySqlJs(path);
    try { expect(readonlyBefore.all('SELECT id FROM synthetic_snapshot')).toEqual([{ id: 1 }]); }
    finally { readonlyBefore.close(); }
    db.exec('COMMIT');
    await vi.advanceTimersByTimeAsync(250);
    const readonlyAfter = await openReadonlySqlJs(path);
    try { expect(readonlyAfter.all('SELECT id FROM synthetic_snapshot')).toEqual([{ id: 1 }, { id: 2 }]); }
    finally { readonlyAfter.close(); }
  });

  it('keeps a read-only loaded image coherent and observes a controlled writer only on fresh import', async () => {
    directory = mkdtempSync(join(tmpdir(), 'ax-sqljs-image-'));
    const path = join(directory, 'synthetic.db');
    const seed = createNativeDatabase(path);
    seed.exec('CREATE TABLE synthetic_snapshot (id INTEGER PRIMARY KEY)');
    seed.prepare('INSERT INTO synthetic_snapshot VALUES (1)').run();
    seed.close?.();
    const image = await openReadonlySqlJs(path);
    const writer = createNativeDatabase(path);
    try {
      const readonly = image as typeof image & { readSnapshot?: <T>(read: () => T) => T };
      expect(readonly).toHaveProperty('readSnapshot', expect.any(Function));
      readonly.readSnapshot!(() => {
        expect(image.all('SELECT id FROM synthetic_snapshot')).toEqual([{ id: 1 }]);
        writer.prepare('INSERT INTO synthetic_snapshot VALUES (2)').run();
        expect(image.all('SELECT id FROM synthetic_snapshot')).toEqual([{ id: 1 }]);
      });
    } finally { writer.close?.(); image.close(); }
    const committed = readFileSync(path);
    const fresh = await openReadonlySqlJs(path);
    try { expect(fresh.all('SELECT id FROM synthetic_snapshot')).toEqual([{ id: 1 }, { id: 2 }]); }
    finally { fresh.close(); }
    expect(readFileSync(path).equals(committed)).toBe(true);
    // Only read-only images coexist with this writer. A stale writable sql.js
    // image must never export over its commits; writable profiles are exclusive.
  });
});
