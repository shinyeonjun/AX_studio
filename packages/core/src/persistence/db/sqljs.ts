import type { Database as SqlJsRawDatabase, SqlJsStatic } from 'sql.js';
import { backup, DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigrations } from './schema.js';
import type { AppDatabase, SqlStatement } from './types.js';

const PERSIST_DEBOUNCE_MS = 250;
const MAX_PERSIST_DELAY_MS = 1_000;
const SQLITE_SIDECARS = ['-wal', '-shm', '-journal'] as const;

function hasSqliteSidecars(filePath: string): boolean {
  return SQLITE_SIDECARS.some((suffix) => existsSync(filePath + suffix));
}

function assertStandaloneDatabase(filePath: string): void {
  if (filePath === ':memory:') return;
  if (hasSqliteSidecars(filePath)) {
    throw new Error('SQLite WAL 또는 journal이 남아 있어 sql.js로 열 수 없습니다. SQLite 백업 또는 체크포인트 후 다시 시도하세요.');
  }
}

function assertQuickCheck(db: DatabaseSync, filePath: string): void {
  const result = db.prepare('PRAGMA quick_check').all();
  if (result.length !== 1 || result[0]?.quick_check !== 'ok') {
    throw new Error(`SQLite 무결성 검사에 실패했습니다: ${filePath}`);
  }
}

/**
 * Native SQLite uses WAL, while sql.js can only safely consume a standalone
 * database file. Recover an orphaned sidecar once at writable startup instead
 * of dropping committed WAL rows or asking the user to delete files by hand.
 * Read-only callers still fail closed in assertStandaloneDatabase().
 */
async function recoverSqliteSidecars(filePath: string): Promise<void> {
  if (filePath === ':memory:' || !hasSqliteSidecars(filePath)) return;
  if (!existsSync(filePath)) {
    throw new Error(
      'SQLite 본체 파일이 없어 WAL 또는 journal을 복구할 수 없습니다. 사이드카를 삭제하지 말고 백업에서 복원하세요.',
    );
  }

  const recoveryDirectory = mkdtempSync(join(tmpdir(), 'ax-sqlite-recovery-'));
  const recoveryPath = join(recoveryDirectory, 'database.db');
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(filePath);
    db.exec('PRAGMA busy_timeout = 0');

    // Keep a validated snapshot before touching the original. The temporary
    // copy is removed after either a successful recovery or a failed attempt.
    await backup(db, recoveryPath);
    const snapshot = new DatabaseSync(recoveryPath, { readOnly: true });
    try {
      assertQuickCheck(snapshot, recoveryPath);
    } finally {
      snapshot.close();
    }

    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all()[0] as
      { busy?: number } | undefined;
    if (checkpoint?.busy !== undefined && Number(checkpoint.busy) !== 0) {
      throw new Error('SQLite WAL 체크포인트가 다른 프로세스에 의해 잠겨 있습니다.');
    }

    const journalMode = db.prepare('PRAGMA journal_mode = DELETE').all()[0] as
      { journal_mode?: string } | undefined;
    if (journalMode?.journal_mode && journalMode.journal_mode.toLowerCase() !== 'delete') {
      throw new Error(`SQLite journal 모드를 전환하지 못했습니다: ${journalMode.journal_mode}`);
    }
    assertQuickCheck(db, filePath);
    db.close();
    db = undefined;

    if (hasSqliteSidecars(filePath)) {
      throw new Error('SQLite WAL 또는 journal이 체크포인트 후에도 남아 있습니다.');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SQLite WAL 또는 journal을 자동 복구하지 못했습니다. 다른 AX Studio/Electron 프로세스를 닫고 다시 시작하세요. ${detail}`,
      { cause: error },
    );
  } finally {
    try {
      db?.close();
    } catch {
      // Preserve the recovery error if closing the failed attempt also fails.
    }
    rmSync(recoveryDirectory, { recursive: true, force: true });
  }
}

function useElectronSqlJsLoader(): boolean {
  return typeof process.versions.electron === 'string';
}

let sqlJsModulePromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsModulePromise) {
    if (useElectronSqlJsLoader()) {
      const nodeRequire = createRequire(import.meta.url);
      const initSqlJs = nodeRequire('sql.js/dist/sql-wasm.js') as typeof import('sql.js').default;
      const wasmPath = join(dirname(nodeRequire.resolve('sql.js/dist/sql-wasm.wasm')), 'sql-wasm.wasm');
      sqlJsModulePromise = initSqlJs({ locateFile: () => wasmPath });
    } else {
      const initSqlJs = (await import('sql.js')).default;
      sqlJsModulePromise = initSqlJs();
    }
  }
  return sqlJsModulePromise;
}

function queryRows(db: SqlJsRawDatabase, sql: string, params: unknown[], limit = Infinity): Record<string, unknown>[] {
  const stmt = db.prepare(sql);
  try {
    if (params.length > 0) stmt.bind(params.map((value) => value === undefined ? null : value) as (string | number | null)[]);
    const rows: Record<string, unknown>[] = [];
    while (rows.length < limit && stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

class SqlJsDatabaseAdapter implements AppDatabase {
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private maxPersistTimer: ReturnType<typeof setTimeout> | undefined;
  private transactionDepth = 0;

  constructor(
    private db: SqlJsRawDatabase,
    private filePath?: string,
  ) {}

  exec(sql: string): void {
    const command = sql.trim().split(/\s+/, 1)[0]?.toUpperCase();
    this.db.run(sql);
    if (command === 'BEGIN') {
      this.transactionDepth += 1;
      return;
    }
    if (command === 'COMMIT' || command === 'END' || command === 'ROLLBACK') {
      this.transactionDepth = Math.max(0, this.transactionDepth - 1);
      if (this.transactionDepth === 0) this.persist();
      return;
    }
    this.persist();
  }

  prepare(sql: string): SqlStatement {
    const db = this.db;
    const persist = () => this.persist();
    return {
      run(...params: unknown[]) {
        const bound = params.map((value) => (value === undefined ? null : value)) as (string | number | null)[];
        db.run(sql, bound);
        persist();
        return { changes: db.getRowsModified() };
      },
      all(...params: unknown[]) {
        return queryRows(db, sql, params);
      },
      get(...params: unknown[]) {
        return queryRows(db, sql, params, 1)[0];
      },
    };
  }

  close(): void {
    if (this.transactionDepth > 0) {
      this.db.run('ROLLBACK');
      this.transactionDepth = 0;
    }
    this.flushPersist();
    this.db.close();
  }

  private flushPersist(): void {
    if (!this.filePath || this.filePath === ':memory:') return;
    if (this.transactionDepth > 0) return;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    if (this.maxPersistTimer) {
      clearTimeout(this.maxPersistTimer);
      this.maxPersistTimer = undefined;
    }
    assertStandaloneDatabase(this.filePath);
    const temporaryPath = this.filePath + '.tmp';
    let snapshot: Uint8Array;
    try {
      snapshot = this.db.export();
    } finally {
      // sql.js export reopens the connection and resets connection pragmas.
      this.db.run('PRAGMA foreign_keys = ON');
    }
    writeFileSync(temporaryPath, Buffer.from(snapshot));
    renameSync(temporaryPath, this.filePath);
  }

  private persist(): void {
    if (!this.filePath || this.filePath === ':memory:') return;
    if (this.transactionDepth > 0) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushPersist(), PERSIST_DEBOUNCE_MS);
    if (!this.maxPersistTimer) {
      this.maxPersistTimer = setTimeout(() => this.flushPersist(), MAX_PERSIST_DELAY_MS);
    }
  }
}

export async function createSqlJsDatabase(path: string): Promise<AppDatabase> {
  await recoverSqliteSidecars(path);
  const SQL = await loadSqlJs();
  assertStandaloneDatabase(path);
  let db: SqlJsRawDatabase;
  if (path === ':memory:') {
    db = new SQL.Database();
  } else if (existsSync(path)) {
    db = new SQL.Database(readFileSync(path));
  } else {
    db = new SQL.Database();
  }
  try {
    db.run('PRAGMA foreign_keys = ON');
    // Do not attach persistence timers until all initialization has succeeded.
    applyMigrations(new SqlJsDatabaseAdapter(db));
    const adapter = new SqlJsDatabaseAdapter(db, path === ':memory:' ? undefined : path);
    adapter.exec('PRAGMA foreign_keys = ON');
    return adapter;
  } catch (error) {
    db.close();
    throw error;
  }
}

export async function openReadonlySqlJs(filePath: string): Promise<{
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
}> {
  const SQL = await loadSqlJs();
  assertStandaloneDatabase(filePath);
  const db = new SQL.Database(readFileSync(filePath));
  return {
    all(sql: string, params: unknown[] = []) {
      return queryRows(db, sql, params);
    },
    close() {
      db.close();
    },
  };
}
