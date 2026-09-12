import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseAsync } from './db.js';
import { createSqlJsDatabase, openReadonlySqlJs } from './db/sqljs.js';
import { WorkflowStore } from './workflow-store.js';

describe('legacy database migrations', () => {
  it('reads only the requested first row instead of evaluating later rows', async () => {
    const db = await createSqlJsDatabase(':memory:');
    try {
      expect(db.prepare(`SELECT CASE WHEN n = 1 THEN n ELSE abs(-9223372036854775808) END AS value
        FROM (SELECT 1 AS n UNION ALL SELECT 2)`).get()).toEqual({ value: 1 });
    } finally { db.close?.(); }
  });

  it('rolls back an open transaction on close while preserving earlier committed writes', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'ax-close-transaction-'));
    const filePath = join(directory, 'database.db');
    try {
      const db = await createSqlJsDatabase(filePath);
      db.exec('CREATE TABLE evidence (value TEXT);');
      db.prepare('INSERT INTO evidence VALUES (?)').run('committed');
      db.exec('BEGIN');
      db.prepare('INSERT INTO evidence VALUES (?)').run('uncommitted');
      db.close?.();
      await vi.advanceTimersByTimeAsync(1500);
      const saved = await openReadonlySqlJs(filePath);
      try { expect(saved.all('SELECT value FROM evidence')).toEqual([{ value: 'committed' }]); }
      finally { saved.close(); }
    } finally {
      vi.useRealTimers();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('leaves the original database unchanged after sql.js migration failure', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'ax-migration-failure-'));
    const filePath = join(directory, 'database.db');
    try {
      const SQL = await (await import('sql.js')).default();
      const legacy = new SQL.Database();
      legacy.run('CREATE TABLE workflow_versions (id TEXT, workflow_id TEXT, version INTEGER);');
      legacy.run("INSERT INTO workflow_versions VALUES ('a', 'workflow', 1), ('b', 'workflow', 1);");
      const original = Buffer.from(legacy.export());
      legacy.close();
      writeFileSync(filePath, original);

      await expect(createSqlJsDatabase(filePath)).rejects.toThrow(/UNIQUE/);
      await vi.advanceTimersByTimeAsync(1500);
      expect(readFileSync(filePath).equals(original)).toBe(true);
    } finally {
      vi.useRealTimers();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('keeps foreign keys enforced after a sql.js disk flush', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'ax-flush-fk-'));
    let db: Awaited<ReturnType<typeof createSqlJsDatabase>> | undefined;
    try {
      db = await createSqlJsDatabase(join(directory, 'database.db'));
      db.exec('CREATE TABLE parent_fixture (id INTEGER PRIMARY KEY); CREATE TABLE child_fixture (parent_id INTEGER REFERENCES parent_fixture(id));');
      await vi.advanceTimersByTimeAsync(1000);
      expect(() => db!.prepare('INSERT INTO child_fixture VALUES (?)').run(999))
        .toThrow(/FOREIGN KEY/);
    } finally {
      db?.close?.();
      vi.useRealTimers();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses sql.js reads and writes when committed rows remain in SQLite WAL', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-wal-guard-'));
    const filePath = join(directory, 'database.db');
    try {
      execFileSync(process.execPath, ['-e', `
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(process.argv[1]);
        db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE evidence (value TEXT);');
        db.exec("INSERT INTO evidence VALUES ('checkpointed'); PRAGMA wal_checkpoint(TRUNCATE);");
        db.exec("INSERT INTO evidence VALUES ('committed-in-wal');");
        process.exit(0);
      `, filePath], { stdio: 'pipe' });
      expect(existsSync(`${filePath}-wal`)).toBe(true);
      const before = readFileSync(filePath);
      for (const open of [openReadonlySqlJs, createSqlJsDatabase]) {
        let opened: { close?: () => void } | undefined;
        try {
          await expect(open(filePath).then((db) => { opened = db; return db; }))
            .rejects.toThrow(/WAL/);
        } finally {
          opened?.close?.();
        }
      }
      expect(readFileSync(filePath)).toEqual(before);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('propagates migration errors and closes the native adapter instead of falling back', async () => {
    const native = {
      close: vi.fn(),
      exec: vi.fn(),
      prepare: vi.fn(),
    };
    const migrationError = new Error('migration constraint');
    const fallback = vi.fn(async () => ({ close: vi.fn() }));

    await expect(createDatabaseAsync(':memory:', {
      createNativeDatabase: () => native,
      applyMigrations: () => {
        throw migrationError;
      },
      createSqlJsDatabase: fallback,
    })).rejects.toBe(migrationError);

    expect(native.close).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('falls back only when the native loader is unavailable', async () => {
    const fallbackDatabase = { close: vi.fn() };
    const fallback = vi.fn(async () => fallbackDatabase);
    const nativeError = Object.assign(
      new Error('better-sqlite3 was compiled against a different Node.js version'),
      { code: 'ERR_DLOPEN_FAILED' },
    );

    await expect(createDatabaseAsync(':memory:', {
      createNativeDatabase: () => {
        throw nativeError;
      },
      createSqlJsDatabase: fallback,
    })).resolves.toBe(fallbackDatabase);

    expect(fallback).toHaveBeenCalledWith(':memory:');
  });

  it('enables foreign-key enforcement for every database backend', async () => {
    const db = await createDatabaseAsync(':memory:');
    try {
      expect((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys?: number } | undefined)?.foreign_keys).toBe(1);
    } finally {
      db.close?.();
    }
  });

  it('renames executions.skill_id to workflow_id on existing databases', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-legacy-db-'));
    const filePath = join(directory, 'ax-studio.db');
    try {
      const initSqlJs = (await import('sql.js')).default;
      const SQL = await initSqlJs();
      const legacy = new SQL.Database();
      legacy.run(`
        CREATE TABLE executions (
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
        INSERT INTO executions (id, skill_id, skill_version, ephemeral, status, started_at, log_json)
        VALUES ('exec-legacy', 'wf-legacy', 1, 0, 'success', '2026-08-01T00:00:00.000Z', '[]');
      `);
      writeFileSync(filePath, Buffer.from(legacy.export()));
      legacy.close();

      const db = await createDatabaseAsync(filePath);
      const columns = (db.prepare('PRAGMA table_info(executions)').all() as Array<{ name: string }>).map(
        (row) => row.name,
      );
      expect(columns).toContain('workflow_id');
      expect(columns).toContain('workflow_version');
      expect(columns).toContain('workspace_session_id');
      expect(columns).not.toContain('skill_id');
      expect(columns).not.toContain('skill_version');

      const store = new WorkflowStore(db);
      expect(store.listExecutions()).toEqual([
        expect.objectContaining({ id: 'exec-legacy', workflowId: 'wf-legacy', workflowVersion: 1 }),
      ]);
      expect(store.createExecution({ workflowId: 'wf-new', ephemeral: true })).toBeTruthy();
      db.close?.();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists sql.js writes by a maximum deadline during continuous writes', async () => {
    vi.useFakeTimers();
    const directory = mkdtempSync(join(tmpdir(), 'ax-sqljs-durability-'));
    const filePath = join(directory, 'ax-studio.db');
    const previousBackend = process.env.AX_DB_BACKEND;
    process.env.AX_DB_BACKEND = 'sqljs';
    let db: Awaited<ReturnType<typeof createDatabaseAsync>> | undefined;
    try {
      db = await createDatabaseAsync(filePath);
      db.exec('CREATE TABLE continuous_writes (value INTEGER NOT NULL)');
      for (let value = 1; value <= 5; value += 1) {
        db.prepare('INSERT INTO continuous_writes (value) VALUES (?)').run(value);
        await vi.advanceTimersByTimeAsync(200);
      }

      expect(existsSync(filePath)).toBe(true);
      const readonly = await openReadonlySqlJs(filePath);
      try {
        expect(readonly.all('SELECT value FROM continuous_writes ORDER BY value')).toHaveLength(5);
      } finally {
        readonly.close();
      }
    } finally {
      db?.close();
      vi.useRealTimers();
      if (previousBackend === undefined) delete process.env.AX_DB_BACKEND;
      else process.env.AX_DB_BACKEND = previousBackend;
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
