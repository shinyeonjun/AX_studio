import type { Database as SqlJsRawDatabase, SqlJsStatic } from 'sql.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export interface SqlStatement {
  run(...params: unknown[]): void;
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

export interface AppDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close?(): void;
}

const MIGRATION_SQL = `
  CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS skill_versions (
    id TEXT PRIMARY KEY,
    skill_id TEXT NOT NULL REFERENCES skills(id),
    version INTEGER NOT NULL,
    ir_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    skill_id TEXT,
    skill_version INTEGER,
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

  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    skill_id TEXT UNIQUE,
    title TEXT NOT NULL,
    summary TEXT,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
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

  constructor(
    private db: SqlJsRawDatabase,
    private filePath?: string,
  ) {}

  exec(sql: string): void {
    this.db.run(sql);
    this.persist();
  }

  prepare(sql: string): SqlStatement {
    const db = this.db;
    const persist = () => this.persist();
    return {
      run(...params: unknown[]) {
        db.run(sql, params as (string | number | null)[]);
        persist();
      },
      all(...params: unknown[]) {
        const stmt = db.prepare(sql);
        if (params.length > 0) stmt.bind(params as (string | number | null)[]);
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
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    writeFileSync(this.filePath, Buffer.from(this.db.export()));
  }

  private persist(): void {
    if (!this.filePath || this.filePath === ':memory:') return;
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

/** @deprecated Use createDatabaseAsync(). sql.js init is async in all environments. */
export function createDatabase(_path: string): AppDatabase {
  throw new Error('Use createDatabaseAsync() — sync database init is no longer supported.');
}

export async function createDatabaseAsync(path: string): Promise<AppDatabase> {
  return createSqlJsDatabase(path);
}

export async function openReadonlySqlite(filePath: string): Promise<{
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
}> {
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
