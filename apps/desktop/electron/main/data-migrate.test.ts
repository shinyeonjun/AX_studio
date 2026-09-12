import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { buildAxDataPaths } from '@ax-studio/core';
import { migrateAxDataIfNeeded } from './data-migrate.js';

vi.mock('electron', () => ({
  app: { getPath: () => process.env.AX_TEST_LEGACY_USER_DATA ?? tmpdir() },
}));

describe('migrateAxDataIfNeeded', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
    delete process.env.AX_TEST_LEGACY_USER_DATA;
  });

  it('reports the migration file when its JSON is malformed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-data-migrate-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(paths.migration, '{invalid json', 'utf8');

    await expect(migrateAxDataIfNeeded(paths)).rejects.toThrow(
      `AX Studio 저장소 마이그레이션 기록을 읽을 수 없습니다: ${paths.migration}`,
    );
  });

  it('does not accept a corrupt snapshot as a completed migration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-invalid-snapshot-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    const legacy = join(root, 'legacy');
    process.env.AX_TEST_LEGACY_USER_DATA = legacy;
    mkdirSync(legacy);
    writeFileSync(join(legacy, 'ax-studio.db'), 'preserve-original');
    await expect(migrateAxDataIfNeeded(paths, {
      backupDatabase: async (_source, destination) => {
        writeFileSync(destination, 'corrupt-snapshot');
      },
    })).rejects.toThrow();
    expect(existsSync(paths.database)).toBe(false);
    expect(existsSync(paths.migration)).toBe(false);
    expect(readFileSync(join(legacy, 'ax-studio.db'), 'utf8')).toBe('preserve-original');
  });

  it('resumes a partial directory migration without overwriting existing files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-data-migrate-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    const legacyUserData = join(root, 'legacy-user-data');
    process.env.AX_TEST_LEGACY_USER_DATA = legacyUserData;
    const legacyCredentials = join(legacyUserData, 'credentials');
    mkdirSync(legacyCredentials, { recursive: true });
    mkdirSync(paths.credentials, { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(join(legacyCredentials, 'existing.secret'), 'legacy', 'utf8');
    writeFileSync(join(legacyCredentials, 'missing.secret'), 'missing', 'utf8');
    writeFileSync(join(paths.credentials, 'existing.secret'), 'current', 'utf8');

    await migrateAxDataIfNeeded(paths);

    expect(readFileSync(join(paths.credentials, 'existing.secret'), 'utf8')).toBe('current');
    expect(readFileSync(join(paths.credentials, 'missing.secret'), 'utf8')).toBe('missing');
    expect(existsSync(paths.migration)).toBe(true);
  });

  it('uses a consistent database snapshot before writing the migration marker', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-data-migrate-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    const legacyUserData = join(root, 'legacy-user-data');
    process.env.AX_TEST_LEGACY_USER_DATA = legacyUserData;
    mkdirSync(join(legacyUserData), { recursive: true });
    mkdirSync(join(paths.root, 'data'), { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(join(legacyUserData, 'ax-studio.db'), 'legacy-base', 'utf8');

    const SQL = await (await import('sql.js')).default();
    const snapshot = new SQL.Database();
    snapshot.run('CREATE TABLE snapshot_fixture (value TEXT);');
    const bytes = Buffer.from(snapshot.export());
    snapshot.close();
    const backupDatabase = vi.fn(async (_source: string, destination: string) => {
      writeFileSync(destination, bytes);
    });

    await migrateAxDataIfNeeded(paths, { backupDatabase });

    expect(backupDatabase).toHaveBeenCalledWith(
      join(legacyUserData, 'ax-studio.db'),
      expect.stringContaining(`${paths.database}.migration-`),
    );
    expect(readFileSync(paths.database).equals(bytes)).toBe(true);
    expect(existsSync(paths.migration)).toBe(true);
  });

  it('keeps the migration retryable when the database snapshot fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-data-migrate-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    const legacyUserData = join(root, 'legacy-user-data');
    process.env.AX_TEST_LEGACY_USER_DATA = legacyUserData;
    mkdirSync(legacyUserData, { recursive: true });
    mkdirSync(join(paths.root, 'data'), { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(join(legacyUserData, 'ax-studio.db'), 'legacy-base', 'utf8');

    await expect(migrateAxDataIfNeeded(paths, {
      backupDatabase: vi.fn(async () => {
        throw new Error('snapshot failed');
      }),
    })).rejects.toThrow('snapshot failed');

    expect(existsSync(paths.database)).toBe(false);
    expect(existsSync(paths.migration)).toBe(false);
  });

  it('can migrate a closed SQLite file when the native adapter is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-data-migrate-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    const legacyUserData = join(root, 'legacy-user-data');
    process.env.AX_TEST_LEGACY_USER_DATA = legacyUserData;
    mkdirSync(legacyUserData, { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    const SQL = await (await import('sql.js')).default();
    const legacy = new SQL.Database();
    legacy.run('CREATE TABLE migration_fixture (value TEXT); INSERT INTO migration_fixture VALUES (\'ok\')');
    writeFileSync(join(legacyUserData, 'ax-studio.db'), Buffer.from(legacy.export()));
    legacy.close();

    await migrateAxDataIfNeeded(paths);

    expect(existsSync(paths.database)).toBe(true);
    expect(existsSync(paths.migration)).toBe(true);
  });

  it('migrates committed WAL rows even when better-sqlite3 is unavailable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-data-migrate-'));
    roots.push(root);
    const paths = buildAxDataPaths(root);
    const legacyUserData = join(root, 'legacy-user-data');
    process.env.AX_TEST_LEGACY_USER_DATA = legacyUserData;
    mkdirSync(legacyUserData, { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    execFileSync(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(process.argv[1]);
      db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE migration_fixture (value TEXT);');
      db.exec("INSERT INTO migration_fixture VALUES ('base'); PRAGMA wal_checkpoint(TRUNCATE);");
      db.exec("INSERT INTO migration_fixture VALUES ('committed-in-wal');");
      process.exit(0);
    `, join(legacyUserData, 'ax-studio.db')], { stdio: 'pipe' });
    expect(existsSync(join(legacyUserData, 'ax-studio.db-wal'))).toBe(true);

    await migrateAxDataIfNeeded(paths);
    const SQL = await (await import('sql.js')).default();
    const migrated = new SQL.Database(readFileSync(paths.database));
    try {
      expect(migrated.exec('SELECT value FROM migration_fixture ORDER BY rowid')[0]?.values)
        .toEqual([['base'], ['committed-in-wal']]);
      expect(existsSync(paths.migration)).toBe(true);
    } finally {
      migrated.close();
    }
  });
});
