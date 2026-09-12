import type { Database as SqlJsRawDatabase, SqlJsStatic } from 'sql.js';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { applyMigrations } from './schema.js';
import type { AppDatabase, SqlStatement } from './types.js';

const PERSIST_DEBOUNCE_MS = 250;
const MAX_PERSIST_DELAY_MS = 1_000;

function assertStandaloneDatabase(filePath: string): void {
  if (filePath === ':memory:') return;
  if (['-wal', '-shm', '-journal'].some((suffix) => existsSync(filePath + suffix))) {
    throw new Error('SQLite WAL 또는 journal이 남아 있어 sql.js로 열 수 없습니다. SQLite 백업 또는 체크포인트 후 다시 시도하세요.');
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

  flush(): void {
    if (this.transactionDepth > 0) throw new Error('Cannot flush an uncommitted transaction');
    this.flushPersist(true);
  }

  private flushPersist(durable = false): void {
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
    writeFileSync(temporaryPath, Buffer.from(snapshot), { flush: durable });
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
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
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
