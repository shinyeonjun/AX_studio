import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createDatabaseAsync } from '../db.js';
import { createNativeDatabase } from '../db-native.js';
import { createSqlJsDatabase } from './sqljs.js';
import { applyMigrations, LATEST_SCHEMA_VERSION, readSchemaVersion } from './schema.js';
import { migrationBackupPath, pruneMigrationBackups } from './backup.js';

describe('versioned schema migrations', () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'ax-schema-version-'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it('stamps a fresh database with the latest version and makes no backup', async () => {
    const filePath = join(directory, 'fresh.db');
    const db = await createDatabaseAsync(filePath);
    try {
      expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(readdirSync(directory).filter((name) => name.includes('.bak-v'))).toEqual([]);
    } finally { db.close?.(); }
  });

  it('looks approvals up by execution through an index, not a table scan', async () => {
    const db = await createDatabaseAsync(join(directory, 'plan.db'));
    try {
      const plan = db.prepare(
        "EXPLAIN QUERY PLAN SELECT 1 FROM approvals WHERE execution_id = ? AND status IN ('pending', 'processing') LIMIT 1",
      ).all('exec-1') as Array<{ detail: string }>;
      expect(plan.map((row) => row.detail).join(' ')).toContain('idx_approvals_execution_status');
    } finally { db.close?.(); }
  });

  it('upgrades a pre-versioning native database, backs it up first and dedupes workflow versions', async () => {
    const filePath = join(directory, 'legacy.db');
    const legacy = new Database(filePath);
    legacy.exec(`CREATE TABLE workflows (id TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE workflow_versions (id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL, version INTEGER NOT NULL,
      ir_json TEXT NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO workflows VALUES ('wf', 'wf', 1, '2026-01-01', '2026-01-01');
      INSERT INTO workflow_versions VALUES ('old', 'wf', 1, '{"v":"old"}', '2026-01-01T00:00:00.000Z');
      INSERT INTO workflow_versions VALUES ('new', 'wf', 1, '{"v":"new"}', '2026-02-01T00:00:00.000Z');`);
    legacy.close();

    const db = await createDatabaseAsync(filePath);
    try {
      expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(db.prepare('SELECT id FROM workflow_versions').all()).toEqual([{ id: 'new' }]);
      expect(db.prepare("PRAGMA index_list('workspace_chats')").all()).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'idx_workspace_chats_updated_at' }),
        expect.objectContaining({ name: 'idx_workspace_chats_workflow_updated_at' }),
      ]));
    } finally { db.close?.(); }

    const backupPath = migrationBackupPath(filePath, 0);
    expect(existsSync(backupPath)).toBe(true);
    const backup = new Database(backupPath, { readonly: true });
    try {
      // The backup is the untouched pre-migration image, duplicates included.
      expect(backup.prepare('SELECT COUNT(*) AS n FROM workflow_versions').get()).toEqual({ n: 2 });
      expect(backup.pragma('user_version', { simple: true })).toBe(0);
    } finally { backup.close(); }
  });

  it('backs up the on-disk image before sql.js migrations', async () => {
    const filePath = join(directory, 'sqljs.db');
    const SQL = await (await import('sql.js')).default();
    const legacy = new SQL.Database();
    legacy.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);');
    writeFileSync(filePath, Buffer.from(legacy.export()));
    legacy.close();

    const db = await createSqlJsDatabase(filePath);
    try {
      expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(existsSync(migrationBackupPath(filePath, 0))).toBe(true);
    } finally { db.close?.(); }
  });

  it('runs nothing and takes no backup when already current', async () => {
    const db = await createSqlJsDatabase(':memory:');
    try {
      const backup = vi.fn();
      applyMigrations(db, { backup });
      expect(backup).not.toHaveBeenCalled();
    } finally { db.close?.(); }
  });

  it('rolls back a failed migration step and leaves the previous version', async () => {
    const filePath = join(directory, 'drift.db');
    const legacy = new Database(filePath);
    legacy.exec("CREATE TABLE workspace_chats (id TEXT PRIMARY KEY, title TEXT, messages_json TEXT); PRAGMA user_version = 1;");
    legacy.close();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(createDatabaseAsync(filePath)).rejects.toThrow(/updated_at/);
    const check = new Database(filePath, { readonly: true });
    try {
      expect(check.pragma('user_version', { simple: true })).toBe(1);
    } finally { check.close(); }
  });

  it('keeps only the newest two migration backups', () => {
    const filePath = join(directory, 'app.db');
    for (const version of [0, 1, 2, 3]) writeFileSync(migrationBackupPath(filePath, version), 'x');
    writeFileSync(`${filePath}.bak-vx`, 'unrelated');
    pruneMigrationBackups(filePath);
    expect(readdirSync(directory).sort()).toEqual(['app.db.bak-v2', 'app.db.bak-v3', 'app.db.bak-vx']);
  });

  it('moves a corrupt native database aside and fails with a clear error', () => {
    const filePath = join(directory, 'corrupt.db');
    writeFileSync(filePath, Buffer.alloc(8192, 7));

    expect(() => createNativeDatabase(filePath)).toThrowError(expect.objectContaining({ code: 'database_corrupt' }));
    expect(existsSync(filePath)).toBe(false);
    expect(readdirSync(directory).some((name) => name.startsWith('corrupt.db.corrupt-'))).toBe(true);
  });
});
