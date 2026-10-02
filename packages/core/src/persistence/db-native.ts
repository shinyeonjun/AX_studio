import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppDatabase, SqlRunResult, SqlStatement } from './db/types.js';
import { assertReadonlySqliteQuery } from './db/readonly-query.js';

function bindParams(params: unknown[]): unknown[] {
  return params.map((value) => (value === undefined ? null : value));
}

function wrapStatement(stmt: Database.Statement): SqlStatement {
  return {
    run(...params: unknown[]): SqlRunResult {
      const result = stmt.run(...(bindParams(params) as never[]));
      return { changes: result.changes };
    },
    all(...params: unknown[]) {
      return stmt.all(...(bindParams(params) as never[])) as Record<string, unknown>[];
    },
    get(...params: unknown[]) {
      return stmt.get(...(bindParams(params) as never[])) as Record<string, unknown> | undefined;
    },
  };
}

function wrapDatabase(db: Database.Database): AppDatabase {
  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string) {
      return wrapStatement(db.prepare(sql));
    },
    persistNow() {
      if (db.inTransaction) throw new Error('persistence_transaction_open');
      // Completed native commits are synchronous under the verified FULL policy.
    },
    close() {
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

export function createNativeDatabase(filePath: string): AppDatabase {
  if (filePath !== ':memory:') {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const db = new Database(filePath === ':memory:' ? ':memory:' : filePath);
  try { configurePragmas(db); }
  catch (error) { db.close(); throw error; }
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
