import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppDatabase, SqlRunResult, SqlStatement } from './db/types.js';
import { assertReadSnapshotSql } from './db/read-snapshot-sql.js';
import { assertReadonlySqliteQuery } from './db/readonly-query.js';
import { quarantineCorruptDatabase } from './db/backup.js';

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
    persistNow() {
      if (db.inTransaction) throw new Error('persistence_transaction_open');
      // Completed native commits are synchronous under the verified FULL policy.
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
  db.pragma('synchronous = FULL');
  if (db.pragma('synchronous', { simple: true }) !== 2) throw new Error('native_database_durability_unverified');
}

const CORRUPTION_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB']);

function isCorruptionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CORRUPTION_CODES.has(code);
}

function assertNativeQuickCheck(db: Database.Database): void {
  const rows = db.pragma('quick_check') as Array<{ quick_check?: unknown }>;
  if (rows.length !== 1 || rows[0]?.quick_check !== 'ok') {
    throw Object.assign(new Error('native_database_quick_check_failed'), { code: 'SQLITE_CORRUPT' });
  }
}

/**
 * Never silently start over on top of a damaged file: move it (and its WAL)
 * aside and fail startup with the quarantine location so it can be recovered.
 */
function failCorruptDatabase(filePath: string, cause: unknown): never {
  let movedTo: string | undefined;
  try { movedTo = quarantineCorruptDatabase(filePath); }
  catch { /* Leave the file in place; the error below still stops startup. */ }
  const where = movedTo ? `손상된 파일은 ${movedTo} 로 옮겨 보관했습니다.` : `손상된 파일 위치: ${filePath}`;
  throw Object.assign(
    new Error(`데이터베이스가 손상되어 열 수 없습니다. ${where} 백업(.bak-v*)에서 복원하거나 다시 시작하면 새 데이터베이스로 시작합니다.`, { cause }),
    { code: 'database_corrupt', databasePath: filePath, ...(movedTo ? { quarantinedPath: movedTo } : {}) },
  );
}

export function createNativeDatabase(filePath: string): AppDatabase {
  const inMemory = filePath === ':memory:';
  if (!inMemory) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const existed = !inMemory && existsSync(filePath);

  let db: Database.Database | undefined;
  try {
    db = new Database(inMemory ? ':memory:' : filePath);
    configurePragmas(db);
    if (existed) assertNativeQuickCheck(db);
  } catch (error) {
    try { db?.close(); } catch { /* Preserve the open error. */ }
    if (existed && isCorruptionError(error)) failCorruptDatabase(filePath, error);
    throw error;
  }
  return wrapDatabase(db);
}

export function openReadonlyNativeSqlite(filePath: string): {
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
} {
  const db = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    if (db.pragma('query_only', { simple: true }) !== 1) throw new Error('sqlite_read_only_unverified');
  } catch (error) { db.close(); throw error; }
  return {
    all(sql: string, params: unknown[] = []) {
      assertReadonlySqliteQuery(sql);
      return db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
    },
    close() {
      db.close();
    },
  };
}
