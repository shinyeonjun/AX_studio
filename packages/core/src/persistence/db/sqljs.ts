import type { Database as SqlJsRawDatabase, SqlJsStatic } from 'sql.js';
import { backup, DatabaseSync } from 'node:sqlite';
import {
  copyFileSync,
  existsSync,
  openSync,
  closeSync,
  fsyncSync,
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
import { writeMigrationBackup } from './backup.js';
import type { AppDatabase, SqlStatement } from './types.js';
import { assertReadSnapshotSql } from './read-snapshot-sql.js';
import { assertReadonlySqliteQuery } from './readonly-query.js';

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
  private readDepth = 0;
  private unusableReason?: 'read_snapshot_cleanup_failed' | 'persistence_transaction_state_unknown'
    | 'persistence_connection_restore_failed' | 'persistence_close_failed';

  constructor(
    private db: SqlJsRawDatabase,
    private filePath?: string,
  ) {}

  private assertUsable(): void {
    if (this.unusableReason) throw new Error(this.unusableReason);
  }

  private failSnapshot(): void {
    this.failClosed('read_snapshot_cleanup_failed');
  }

  private failClosed(reason: NonNullable<SqlJsDatabaseAdapter['unusableReason']>): void {
    this.unusableReason ??= reason;
    this.clearPersistTimers();
  }

  private hasCallerTransaction(): boolean {
    this.assertOutsideSnapshot();
    // SQLite owns SAVEPOINT names/nesting, compound and prepared controls,
    // and implicit rollbacks. Probe engine state rather than counting BEGINs.
    try {
      this.db.run('BEGIN DEFERRED');
    } catch (error) {
      if (error instanceof Error && error.message === 'cannot start a transaction within a transaction') return true;
      this.failClosed('persistence_transaction_state_unknown');
      throw error;
    }
    try {
      this.db.run('ROLLBACK'); // Only the successfully acquired probe is ours.
    } catch (error) {
      this.failClosed('persistence_transaction_state_unknown');
      throw error;
    }
    return false;
  }

  private assertOutsideSnapshot(): void {
    this.assertUsable();
    if (this.readDepth > 0) throw new Error('read_snapshot_write_forbidden');
  }

  private assertSnapshotQuery(sql: string): void {
    this.assertUsable();
    if (this.readDepth === 0) return;
    assertReadSnapshotSql(sql);
  }

  readSnapshot<T>(read: () => T): T {
    this.assertUsable();
    if (this.readDepth > 0) return read();
    const queryOnly = queryRows(this.db, 'PRAGMA query_only', [])[0]?.query_only;
    // Join caller SAVEPOINTs using raw control. Never use exec here: it
    // schedules persistence of the loaded image.
    let acquired = false;
    let failed = false;
    this.readDepth += 1;
    try {
      this.db.run('SAVEPOINT ax_read_snapshot');
      acquired = true;
      this.db.run('PRAGMA query_only = ON');
      const result = read();
      this.db.run('RELEASE ax_read_snapshot');
      acquired = false;
      return result;
    } catch (error) {
      failed = true;
      if (acquired) {
        try {
          this.db.run('ROLLBACK TO ax_read_snapshot');
          this.db.run('RELEASE ax_read_snapshot');
        } catch { this.failSnapshot(); }
      } else this.failSnapshot(); // Acquisition failed; do not assume ownership/state.
      throw error;
    } finally {
      this.readDepth -= 1;
      try { this.db.run(`PRAGMA query_only = ${queryOnly ? 'ON' : 'OFF'}`); }
      catch (error) {
        this.failSnapshot();
        if (!failed) throw error;
      }
    }
  }

  exec(sql: string): void {
    this.assertOutsideSnapshot();
    this.runAndPersist(sql);
  }

  private runAndPersist(sql: string, params?: (string | number | null)[]): void {
    let failed = false;
    try { this.db.run(sql, params); }
    catch (error) { failed = true; throw error; }
    finally {
      // Batches and SQLite FAIL can retain writes before throwing. Queue the
      // image even on failure; the flush still fences actual caller ownership.
      try { this.persist(); }
      catch (error) { if (!failed) throw error; }
    }
  }

  prepare(sql: string): SqlStatement {
    this.assertUsable();
    const db = this.db;
    const runAndPersist = (params: (string | number | null)[]) => this.runAndPersist(sql, params);
    const assertOutsideSnapshot = () => this.assertOutsideSnapshot();
    const assertSnapshotQuery = () => this.assertSnapshotQuery(sql);
    return {
      run(...params: unknown[]) {
        assertOutsideSnapshot();
        const bound = params.map((value) => (value === undefined ? null : value)) as (string | number | null)[];
        runAndPersist(bound);
        return { changes: db.getRowsModified() };
      },
      all(...params: unknown[]) {
        assertSnapshotQuery();
        return queryRows(db, sql, params);
      },
      get(...params: unknown[]) {
        assertSnapshotQuery();
        return queryRows(db, sql, params, 1)[0];
      },
    };
  }

  discard(): void {
    if (this.readDepth > 0) throw new Error('read_snapshot_write_forbidden');
    this.clearPersistTimers();
    this.db.close();
  }

  close(): void {
    if (this.readDepth > 0) throw new Error('read_snapshot_write_forbidden');
    this.clearPersistTimers();
    if (this.unusableReason) {
      this.discard();
      return; // Never export an image whose transaction/setting cleanup failed.
    }
    let failure: unknown;
    let failed = false;
    try {
      if (this.hasCallerTransaction()) {
        try { this.db.run('ROLLBACK'); } // Explicit disposal, never normal persistence.
        catch (error) {
          this.failClosed('persistence_transaction_state_unknown');
          throw error;
        }
      }
      this.flushPersist(true);
    } catch (error) {
      failure = error;
      failed = true;
    }
    try {
      this.db.close();
    } catch (error) {
      this.failClosed('persistence_close_failed');
      if (!failed) failure = error;
      failed = true;
    }
    if (failed) throw failure;
  }

  persistNow(): void {
    this.assertOutsideSnapshot();
    this.flushPersist(true);
  }

  private flushPersist(requireIdle = false): boolean {
    this.assertUsable();
    if (this.hasCallerTransaction()) {
      if (requireIdle) throw new Error('persistence_transaction_open');
      return false; // Retain pending work and timers; only the caller can end ownership.
    }
    this.clearPersistTimers();
    if (!this.filePath || this.filePath === ':memory:') return true;
    assertStandaloneDatabase(this.filePath);
    const temporaryPath = this.filePath + '.tmp';
    try {
      let snapshot: Uint8Array;
      let exportFailed = false;
      try {
        snapshot = this.db.export();
      } catch (error) {
        exportFailed = true;
        throw error;
      } finally {
        // sql.js export reopens the connection and resets connection pragmas.
        try { this.db.run('PRAGMA foreign_keys = ON'); }
        catch (error) {
          this.failClosed('persistence_connection_restore_failed');
          if (!exportFailed) throw error; // Preserve a primary export failure.
        }
      }
      const handle = openSync(temporaryPath, 'w');
      try { writeFileSync(handle, snapshot); fsyncSync(handle); }
      finally { closeSync(handle); }
      renameSync(temporaryPath, this.filePath);
    } finally {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // Preserve the persistence error; the next successful flush replaces this snapshot.
      }
    }
    return true;
  }

  private clearPersistTimers(): void {
    clearTimeout(this.persistTimer);
    clearTimeout(this.maxPersistTimer);
    this.persistTimer = undefined;
    this.maxPersistTimer = undefined;
  }

  private flushPersistFromTimer(): void {
    try {
      if (!this.flushPersist()) this.persist();
    } catch (error) {
      console.error('[sql.js] deferred database persistence failed:', error);
    }
  }

  private persist(): void {
    this.assertUsable();
    if (!this.filePath || this.filePath === ':memory:') return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.flushPersistFromTimer();
    }, PERSIST_DEBOUNCE_MS);
    if (!this.maxPersistTimer) {
      this.maxPersistTimer = setTimeout(() => {
        this.maxPersistTimer = undefined;
        this.flushPersistFromTimer();
      }, MAX_PERSIST_DELAY_MS);
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
  let adapter: SqlJsDatabaseAdapter | undefined;
  try {
    db.run('PRAGMA foreign_keys = ON');
    // Do not attach persistence timers until all initialization has succeeded.
    const persistedFile = path !== ':memory:' && existsSync(path);
    applyMigrations(new SqlJsDatabaseAdapter(db), persistedFile ? {
      // sql.js has not written anything yet, so the file on disk is the pre-migration image.
      backup: (fromVersion) => writeMigrationBackup(path, fromVersion, (target) => copyFileSync(path, target)),
    } : {});
    adapter = new SqlJsDatabaseAdapter(db, path === ':memory:' ? undefined : path);
    adapter.exec('PRAGMA foreign_keys = ON');
    adapter.persistNow();
    return adapter;
  } catch (error) {
    try {
      if (adapter) adapter.discard(); // Cancel timers and never persist failed initialization.
      else db.close();
    } catch { /* Retain the primary initialization failure over disposal failure. */ }
    throw error;
  }
}

export async function openReadonlySqlJs(filePath: string): Promise<{
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  readSnapshot<T>(read: () => T): T;
  close(): void;
}> {
  const SQL = await loadSqlJs();
  assertStandaloneDatabase(filePath);
  const db = new SQL.Database(readFileSync(filePath));
  try {
    db.run('PRAGMA query_only = ON');
    if (queryRows(db, 'PRAGMA query_only', [])[0]?.query_only !== 1) throw new Error('sqlite_read_only_unverified');
  } catch (error) { db.close(); throw error; }
  const adapter = new SqlJsDatabaseAdapter(db);
  return {
    all(sql: string, params: unknown[] = []) {
      assertReadonlySqliteQuery(sql);
      return adapter.prepare(sql).all(...params);
    },
    readSnapshot<T>(read: () => T): T {
      return adapter.readSnapshot(read);
    },
    close() {
      adapter.close();
    },
  };
}
