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
    trigger_type TEXT
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
`;

function useSqlJsBackend(): boolean {
  return typeof process.versions.electron === 'string';
}

function createNodeSqliteDatabase(path: string): AppDatabase {
  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(MIGRATION_SQL);
  return db as AppDatabase;
}

let sqlJsModulePromise: Promise<SqlJsStatic> | null = null;

async function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsModulePromise) {
    if (useSqlJsBackend()) {
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
    this.persist();
    this.db.close();
  }

  private persist(): void {
    if (!this.filePath || this.filePath === ':memory:') return;
    writeFileSync(this.filePath, Buffer.from(this.db.export()));
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
  adapter.exec(MIGRATION_SQL);
  return adapter;
}

export function createDatabase(path: string): AppDatabase {
  if (useSqlJsBackend()) {
    throw new Error('Electron requires async database init. Use createDatabaseAsync().');
  }
  return createNodeSqliteDatabase(path);
}

export async function createDatabaseAsync(path: string): Promise<AppDatabase> {
  if (useSqlJsBackend()) {
    return createSqlJsDatabase(path);
  }
  return createNodeSqliteDatabase(path);
}

export async function openReadonlySqlite(filePath: string): Promise<{
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
}> {
  if (useSqlJsBackend()) {
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

  const nodeRequire = createRequire(import.meta.url);
  const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(filePath, { readOnly: true });
  return {
    all(sql: string, params: unknown[] = []) {
      const stmt = db.prepare(sql);
      return stmt.all(...(params as never[])) as Record<string, unknown>[];
    },
    close() {
      db.close();
    },
  };
}
