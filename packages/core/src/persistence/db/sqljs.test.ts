import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createSqlJsDatabase, openReadonlySqlJs } from './sqljs.js';

describe('sql.js database persistence', () => {
  it('persists migrations before returning a file-backed database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sqljs-'));
    const path = join(root, 'database.sqlite');
    const db = await createSqlJsDatabase(path);

    try {
      expect(existsSync(path)).toBe(true);
      const readonly = await openReadonlySqlJs(path);
      try {
        expect(readonly.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workflows'")).toHaveLength(1);
      } finally {
        readonly.close();
      }
    } finally {
      db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('logs deferred write failures and still closes the database', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sqljs-'));
    const path = join(root, 'database.sqlite');
    const db = await createSqlJsDatabase(path);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    try {
      db.prepare('CREATE TABLE deferred_failure (id INTEGER)').run();
      rmSync(root, { recursive: true, force: true });

      await vi.advanceTimersByTimeAsync(250);
      expect(log).toHaveBeenCalledWith(
        '[sql.js] deferred database persistence failed:',
        expect.any(Error),
      );
      expect(() => db.close()).toThrow();
      expect(() => db.prepare('SELECT 1').get()).toThrow();
    } finally {
      vi.useRealTimers();
      log.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('removes a failed temporary snapshot and closes after a rename failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sqljs-'));
    const path = join(root, 'database.sqlite');
    const db = await createSqlJsDatabase(path);
    renameSync(path, path + '.original');
    mkdirSync(path);

    try {
      expect(() => db.close()).toThrow();
      expect(existsSync(path + '.tmp')).toBe(false);
      expect(() => db.prepare('SELECT 1').get()).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
