import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type TestContext } from 'vitest';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import type { SqlJsStatic } from 'sql.js';
import { legacyHomeDataRoot } from '@ax-studio/core';
import { legacyElectronUserDataDir, legacyHomeArtifactRoot } from './data-paths.js';
import { createMigrationTestFixture, type MigrationTestEnvironment, type MigrationTestFixture } from './data-migrate.test-fixture.js';

const fixtureScope = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import('node:async_hooks');
  return new AsyncLocalStorage<MigrationTestEnvironment>();
});
vi.mock('node:os', async importOriginal => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, homedir: () => {
    const fixture = fixtureScope.getStore();
    if (!fixture) throw new Error('Synthetic migration home is not bound');
    return fixture.home;
  } };
});

vi.mock('electron', () => ({
  app: { getPath: () => {
    const fixture = fixtureScope.getStore();
    if (!fixture) throw new Error('Synthetic migration legacy path is not bound');
    return fixture.legacyUserData;
  } },
}));

describe('migrateAxDataIfNeeded', () => {
  const fixtures = new WeakMap<TestContext, MigrationTestFixture>();
  function fixtureFor(context: TestContext): MigrationTestFixture {
    const fixture = fixtures.get(context);
    if (!fixture) throw new Error('Migration test has no owned fixture');
    return fixture;
  }
  function ownedTest(name: string, operation: (fixture: MigrationTestFixture) => void | Promise<void>) {
    it(name, context => {
      const fixture = fixtureFor(context);
      return fixture.runTest(() => operation(fixture));
    });
  }
  beforeEach(context => {
    const fixture = createMigrationTestFixture(fixtureScope);
    fixtures.set(context, fixture);
    fixture.inScope(() => {
      expect(legacyHomeDataRoot()).toBe(join(fixture.home, '.ax-studio'));
      expect(legacyHomeArtifactRoot()).toBe(join(fixture.home, '.ax-studio'));
    });
  });
  afterEach(context => fixtureFor(context).cleanup());

  function delayedMigration(fixture: MigrationTestFixture, reject = false) {
    mkdirSync(fixture.legacyUserData, { recursive: true });
    writeFileSync(join(fixture.legacyUserData, 'ax-studio.db'), 'synthetic-source');
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const opened = new Promise<void>(resolve => { ready = resolve; });
    let closed = false;
    let destinationPath = '';
    const migration = fixture.migrate({ backupDatabase: async (_source, destination) => {
      destinationPath = destination;
      const snapshot = new DatabaseSync(destination);
      try {
        snapshot.exec('CREATE TABLE delayed_fixture (value TEXT)');
        ready();
        await gate;
        if (reject) throw new Error('controlled snapshot rejection');
      } finally { snapshot.close(); closed = true; }
    } });
    return { migration, release, closed: () => closed, destination: () => destinationPath,
      opened: Promise.race([opened, migration.then(() => { throw new Error('Snapshot did not open'); })]) };
  }

  ownedTest('reports the migration file when its JSON is malformed', async fixture => {
    const { paths } = fixture;
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(paths.migration, '{invalid json', 'utf8');

    await expect(fixture.migrate()).rejects.toThrow(
      `AX Studio 저장소 마이그레이션 기록을 읽을 수 없습니다: ${paths.migration}`,
    );
  });

  ownedTest('does not accept a corrupt snapshot as a completed migration', async fixture => {
    const { paths, legacyUserData: legacy } = fixture;
    mkdirSync(legacy);
    writeFileSync(join(legacy, 'ax-studio.db'), 'preserve-original');
    await expect(fixture.migrate({
      backupDatabase: async (_source, destination) => {
        writeFileSync(destination, 'corrupt-snapshot');
      },
    })).rejects.toThrow();
    expect(existsSync(paths.database)).toBe(false);
    expect(existsSync(paths.migration)).toBe(false);
    expect(readFileSync(join(legacy, 'ax-studio.db'), 'utf8')).toBe('preserve-original');
  });

  ownedTest('resumes a partial directory migration without overwriting existing files', async fixture => {
    const { paths, legacyUserData } = fixture;
    const legacyCredentials = join(legacyUserData, 'credentials');
    mkdirSync(legacyCredentials, { recursive: true });
    mkdirSync(paths.credentials, { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(join(legacyCredentials, 'existing.secret'), 'legacy', 'utf8');
    writeFileSync(join(legacyCredentials, 'missing.secret'), 'missing', 'utf8');
    writeFileSync(join(paths.credentials, 'existing.secret'), 'current', 'utf8');

    await fixture.migrate();

    expect(readFileSync(join(paths.credentials, 'existing.secret'), 'utf8')).toBe('current');
    expect(readFileSync(join(paths.credentials, 'missing.secret'), 'utf8')).toBe('missing');
    expect(existsSync(paths.migration)).toBe(true);
  });

  ownedTest('uses a consistent database snapshot before writing the migration marker', async fixture => {
    const { paths, legacyUserData } = fixture;
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

    await fixture.migrate({ backupDatabase });

    expect(backupDatabase).toHaveBeenCalledWith(
      join(legacyUserData, 'ax-studio.db'),
      expect.stringContaining(`${paths.database}.migration-`),
    );
    expect(readFileSync(paths.database).equals(bytes)).toBe(true);
    expect(existsSync(paths.migration)).toBe(true);
  });

  ownedTest('keeps the migration retryable when the database snapshot fails', async fixture => {
    const { paths, legacyUserData } = fixture;
    mkdirSync(legacyUserData, { recursive: true });
    mkdirSync(join(paths.root, 'data'), { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    writeFileSync(join(legacyUserData, 'ax-studio.db'), 'legacy-base', 'utf8');

    await expect(fixture.migrate({
      backupDatabase: vi.fn(async () => {
        throw new Error('snapshot failed');
      }),
    })).rejects.toThrow('snapshot failed');

    expect(existsSync(paths.database)).toBe(false);
    expect(existsSync(paths.migration)).toBe(false);
  });

  ownedTest('can migrate a closed SQLite file when the native adapter is unavailable', async fixture => {
    const { paths, legacyUserData } = fixture;
    mkdirSync(legacyUserData, { recursive: true });
    mkdirSync(paths.config, { recursive: true });
    const SQL = await (await import('sql.js')).default();
    const legacy = new SQL.Database();
    legacy.run('CREATE TABLE migration_fixture (value TEXT); INSERT INTO migration_fixture VALUES (\'ok\')');
    writeFileSync(join(legacyUserData, 'ax-studio.db'), Buffer.from(legacy.export()));
    legacy.close();

    await fixture.migrate();

    expect(existsSync(paths.database)).toBe(true);
    expect(existsSync(paths.migration)).toBe(true);
  });

  ownedTest('waits for an owned SQLite snapshot before deleting fixture directories', async () => {
    const fixture = createMigrationTestFixture(fixtureScope);
    const { root, home, legacyUserData } = fixture;
    const snapshot = delayedMigration(fixture);
    await snapshot.opened;
    let cleanupSettled = false;
    const cleanup = fixture.cleanup().then(
      () => { cleanupSettled = true; return undefined; },
      error => { cleanupSettled = true; return error; },
    );
    try {
      await Promise.resolve();
      expect(cleanupSettled).toBe(false);
      expect(existsSync(home)).toBe(true);
      expect(existsSync(legacyUserData)).toBe(true);
      snapshot.release();
      await snapshot.migration;
      expect(await cleanup).toBeUndefined();
      expect(snapshot.closed()).toBe(true);
      expect(existsSync(root)).toBe(false);
    } finally {
      snapshot.release();
      await snapshot.migration;
      await cleanup;
    }
  });

  ownedTest('confines a timed-out generation cleanup and callback to that generation', async () => {
    const first = createMigrationTestFixture(fixtureScope);
    const second = createMigrationTestFixture(fixtureScope);
    const oldSnapshot = delayedMigration(first);
    const nextSnapshot = delayedMigration(second);
    const document = join(second.home, '.ax-studio', 'documents', 'second-owned.txt');
    mkdirSync(join(second.home, '.ax-studio', 'documents'), { recursive: true });
    writeFileSync(document, 'second-test-owned-evidence');
    let continueBody!: () => void;
    const bodyGate = new Promise<void>(resolve => { continueBody = resolve; });
    let resumedHome = '';
    let resumedLegacy = '';
    let lateOperationError: unknown;
    const oldBody = first.runTest(async () => {
      await oldSnapshot.migration;
      await bodyGate;
      resumedHome = legacyHomeDataRoot();
      resumedLegacy = legacyElectronUserDataDir();
      try { first.migrate(); } catch (error) { lateOperationError = error; }
    });
    // These are the two callbacks that can survive Vitest's test/hook wrappers.
    const oldCleanup = first.cleanup();
    try {
      await Promise.all([oldSnapshot.opened, nextSnapshot.opened]);
      expect(first.home).not.toBe(second.home);
      oldSnapshot.release();
      await oldSnapshot.migration;
      expect(existsSync(first.root)).toBe(true); // Its test callback still owns it.
      continueBody();
      await oldBody;
      await oldCleanup;
      expect(resumedHome).toBe(join(first.home, '.ax-studio'));
      expect(resumedLegacy).toBe(first.legacyUserData);
      expect(lateOperationError).toEqual(expect.objectContaining({ message: expect.stringContaining('fixture is closing') }));
      expect(existsSync(first.root)).toBe(false);
      expect(nextSnapshot.closed()).toBe(false);
      expect(existsSync(nextSnapshot.destination())).toBe(true);
      expect(existsSync(second.home)).toBe(true);
      expect(readFileSync(document, 'utf8')).toBe('second-test-owned-evidence');
      nextSnapshot.release();
      await nextSnapshot.migration;
      expect(readFileSync(join(second.paths.documents, 'second-owned.txt'), 'utf8')).toBe('second-test-owned-evidence');
    } finally {
      oldSnapshot.release(); nextSnapshot.release(); continueBody();
      await Promise.allSettled([oldSnapshot.migration, nextSnapshot.migration, oldBody]);
      await Promise.all([oldCleanup, second.cleanup()]);
    }
  });

  ownedTest('keeps an unsettled owner isolated while a later generation finishes', async () => {
    const pending = createMigrationTestFixture(fixtureScope);
    const next = createMigrationTestFixture(fixtureScope);
    const snapshot = delayedMigration(pending);
    let cleanupSettled = false;
    const cleanup = pending.cleanup().then(() => { cleanupSettled = true; });
    try {
      await snapshot.opened;
      await next.migrate();
      await next.cleanup();
      expect(cleanupSettled).toBe(false);
      expect(snapshot.closed()).toBe(false);
      expect(existsSync(pending.home)).toBe(true);
      expect(existsSync(snapshot.destination())).toBe(true);
      expect(existsSync(next.root)).toBe(false);
      expect(() => pending.migrate()).toThrow('fixture is closing');
    } finally {
      snapshot.release();
      await snapshot.migration;
      await cleanup;
      await next.cleanup();
    }
  });

  ownedTest('preserves a rejected late migration while cleaning only its owner', async () => {
    const failed = createMigrationTestFixture(fixtureScope);
    const next = createMigrationTestFixture(fixtureScope);
    const snapshot = delayedMigration(failed, true);
    const rejection = expect(snapshot.migration).rejects.toThrow('controlled snapshot rejection');
    const cleanup = failed.cleanup();
    try {
      await snapshot.opened;
      snapshot.release();
      await rejection;
      await cleanup;
      expect(snapshot.closed()).toBe(true);
      expect(existsSync(failed.root)).toBe(false);
      expect(existsSync(next.home)).toBe(true);
      await next.migrate();
      expect(existsSync(next.paths.migration)).toBe(true);
    } finally {
      snapshot.release();
      await Promise.allSettled([snapshot.migration, rejection]);
      await Promise.all([cleanup, next.cleanup()]);
    }
  });

  describe('committed WAL fixture', () => {
    const sqlByFixture = new WeakMap<MigrationTestFixture, SqlJsStatic>();
    beforeEach(async context => {
      const fixture = fixtureFor(context);
      const { paths, legacyUserData } = fixture;
      mkdirSync(legacyUserData, { recursive: true });
      mkdirSync(paths.config, { recursive: true });
      // Abrupt child exit deliberately leaves committed rows in the WAL.
      // execFileSync waits for that owner to exit before migration starts.
      execFileSync(process.execPath, ['-e', `
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(process.argv[1]);
        db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE migration_fixture (value TEXT);');
        db.exec("INSERT INTO migration_fixture VALUES ('base'); PRAGMA wal_checkpoint(TRUNCATE);");
        db.exec("INSERT INTO migration_fixture VALUES ('committed-in-wal');");
        process.exit(0);
      `, join(legacyUserData, 'ax-studio.db')], { stdio: 'pipe', timeout: 5000, windowsHide: true });
      expect(existsSync(join(legacyUserData, 'ax-studio.db-wal'))).toBe(true);
      sqlByFixture.set(fixture, await (await import('sql.js')).default());
    });

    ownedTest('migrates committed WAL rows even when better-sqlite3 is unavailable', async fixture => {
      const { paths } = fixture;
      const SQL = sqlByFixture.get(fixture)!;
      await fixture.migrate();
      const migrated = new SQL.Database(readFileSync(paths.database));
      try {
        expect(migrated.exec('SELECT value FROM migration_fixture ORDER BY rowid')[0]?.values)
          .toEqual([['base'], ['committed-in-wal']]);
        expect(existsSync(paths.migration)).toBe(true);
      } finally { migrated.close(); }
    });
  });
});
