import type { Database as SqlJsRawDatabase, SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createNativeDatabase, openReadonlyNativeSqlite } from './db-native.js';

export interface SqlRunResult {
  changes: number;
}

export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult;
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

export interface AppDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close?(): void;
}

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workflow_versions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    version INTEGER NOT NULL,
    ir_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT,
    workflow_version INTEGER,
    ephemeral INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    error_code TEXT,
    log_json TEXT NOT NULL DEFAULT '[]',
    trigger_type TEXT,
    ir_json TEXT
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL REFERENCES executions(id),
    action_ids_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    payload_json TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS connections (
    connector TEXT PRIMARY KEY,
    connected INTEGER NOT NULL DEFAULT 0,
    config_json TEXT
  );

  CREATE TABLE IF NOT EXISTS workspace_chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    messages_json TEXT NOT NULL,
    workflow_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trigger_receipts (
    dedupe_key TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    status TEXT NOT NULL,
    execution_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id ON workflow_versions(workflow_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_versions_workflow_version ON workflow_versions(workflow_id, version);
  CREATE INDEX IF NOT EXISTS idx_executions_started_at ON executions(started_at);
  CREATE INDEX IF NOT EXISTS idx_executions_workflow_id ON executions(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_trigger_receipts_workflow_id ON trigger_receipts(workflow_id);
`;

function columnNames(db: AppDatabase, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  return rows.map((row) => String(row.name ?? ''));
}

function applyMigrations(db: AppDatabase) {
  db.exec(MIGRATION_SQL);
  if (!columnNames(db, 'executions').includes('ir_json')) {
    db.exec('ALTER TABLE executions ADD COLUMN ir_json TEXT');
  }
  if (!columnNames(db, 'workspace_chats').includes('workflow_id')) {
    db.exec('ALTER TABLE workspace_chats ADD COLUMN workflow_id TEXT');
  }
  db.exec(
    "UPDATE executions SET status = 'pending_approval', finished_at = NULL, error_code = 'pending_approval' " +
      "WHERE status = 'failed' AND error_code = 'pending_approval' " +
      "AND id IN (SELECT execution_id FROM approvals WHERE status IN ('pending', 'processing'))",
  );
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

class SqlJsDatabaseAdapter implements AppDatabase {
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
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
        const bound = params.map((value) => (value === undefined ? null : value)) as (string | number | null)[];
        const stmt = db.prepare(sql);
        if (bound.length > 0) stmt.bind(bound);
        const rows: Record<string, unknown>[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      },
      get(...params: unknown[]) {
        const rows = this.all(...params);
        return rows[0];
      },
    };
  }

  close(): void {
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
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, Buffer.from(this.db.export()));
    renameSync(temporaryPath, this.filePath);
  }

  private persist(): void {
    if (!this.filePath || this.filePath === ':memory:') return;
    if (this.transactionDepth > 0) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.flushPersist(), 250);
  }
}

async function createSqlJsDatabase(path: string): Promise<AppDatabase> {
  const SQL = await loadSqlJs();
  let db: SqlJsRawDatabase;
  if (path === ':memory:') {
    db = new SQL.Database();
  } else if (existsSync(path)) {
    db = new SQL.Database(readFileSync(path));
  } else {
    db = new SQL.Database();
  }
  const adapter = new SqlJsDatabaseAdapter(db, path === ':memory:' ? undefined : path);
  applyMigrations(adapter);
  return adapter;
}

function shouldUseSqlJsBackend(): boolean {
  return process.env.AX_DB_BACKEND === 'sqljs';
}

function logDatabaseFallback(message: string, hint: string, error: unknown): void {
  if (process.env.AX_DEBUG_DB !== '1') return;
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`[db] ${message}.${hint} ${detail}`);
}

/** @deprecated Use createDatabaseAsync(). sql.js init is async in all environments. */
export function createDatabase(_path: string): AppDatabase {
  throw new Error('Use createDatabaseAsync() — sync database init is no longer supported.');
}

export async function createDatabaseAsync(path: string): Promise<AppDatabase> {
  if (!shouldUseSqlJsBackend()) {
    try {
      const adapter = createNativeDatabase(path);
      applyMigrations(adapter);
      return adapter;
    } catch (error) {
      const hint =
        typeof process.versions.electron === 'string'
          ? ' Run `npm run ensure:native -w @ax-studio/desktop` (or `npm run dev`, which runs it automatically).'
          : '';
      logDatabaseFallback('better-sqlite3 unavailable; using sql.js', hint, error);
    }
  }
  return createSqlJsDatabase(path);
}

export async function openReadonlySqlite(filePath: string): Promise<{
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
}> {
  if (!shouldUseSqlJsBackend()) {
    try {
      return openReadonlyNativeSqlite(filePath);
    } catch (error) {
      const hint =
        typeof process.versions.electron === 'string'
          ? ' Run `npm run ensure:native -w @ax-studio/desktop`.'
          : '';
      logDatabaseFallback('better-sqlite3 readonly open failed; using sql.js', hint, error);
    }
  }

  const SQL = await loadSqlJs();
  const db = new SQL.Database(readFileSync(filePath));
  return {
    all(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      if (params.length > 0) stmt.bind(params as (string | number | null)[]);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    close() {
      db.close();
    },
  };
}
