import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppDatabase, SqlRunResult, SqlStatement } from './db/types.js';
import { assertReadSnapshotSql } from './db/read-snapshot-sql.js';

function bindParams(params: unknown[]): unknown[] {
  return params.map((value) => (value === undefined ? null : value));
}

function wrapStatement(stmt: Database.Statement, assertReadable: () => void): SqlStatement {
  return {
    run(...params: unknown[]): SqlRunResult {
      assertReadable();
      const result = stmt.run(...(bindParams(params) as never[]));
      return { changes: result.changes };
    },
    all(...params: unknown[]) {
      assertReadable();
      return stmt.all(...(bindParams(params) as never[])) as Record<string, unknown>[];
    },
    get(...params: unknown[]) {
      assertReadable();
      return stmt.get(...(bindParams(params) as never[])) as Record<string, unknown> | undefined;
    },
  };
}

function wrapDatabase(db: Database.Database): AppDatabase {
  let readDepth = 0;
  function assertOutsideSnapshot() {
    if (readDepth > 0) throw new Error('read_snapshot_write_forbidden');
  }
  return {
    exec(sql: string) {
      assertOutsideSnapshot();
      db.exec(sql);
    },
    prepare(sql: string) {
      if (readDepth > 0) assertReadSnapshotSql(sql);
      const statement = db.prepare(sql);
      return wrapStatement(statement, () => {
        // Transaction control and connection-setting pragmas may be readonly
        // to SQLite, but cannot release or weaken the enclosing snapshot.
        if (readDepth > 0) {
          assertReadSnapshotSql(sql);
          if (!statement.readonly || !statement.reader) throw new Error('read_snapshot_write_forbidden');
        }
      });
    },
    readSnapshot<T>(read: () => T): T {
      const owned = !db.inTransaction;
      if (owned) db.exec('BEGIN DEFERRED');
      readDepth += 1;
      try {
        const result = read();
        if (owned) db.exec('COMMIT');
        return result;
      } catch (error) {
        if (owned && db.inTransaction) {
          try { db.exec('ROLLBACK'); } catch { /* Retain the original read error. */ }
        }
        throw error;
      } finally {
        readDepth -= 1;
      }
    },
    close() {
      assertOutsideSnapshot();
      db.close();
    },
  };
}

function configurePragmas(db: Database.Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
}

export function createNativeDatabase(filePath: string): AppDatabase {
  if (filePath !== ':memory:') {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const db = new Database(filePath === ':memory:' ? ':memory:' : filePath);
  configurePragmas(db);
  return wrapDatabase(db);
}

export function openReadonlyNativeSqlite(filePath: string): {
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
} {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  return {
    all(sql: string, params: unknown[] = []) {
      return db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
    },
    close() {
      db.close();
    },
  };
}
