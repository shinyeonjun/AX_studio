import type { AppDatabase } from './types.js';
import { INITIAL_SCHEMA_SQL, SCHEMA_V2_INDEXES_SQL } from './schema/ddl.js';
import { applyLegacyMigrations } from './schema/legacy.js';

export interface SchemaMigration {
  version: number;
  name: string;
  up(db: AppDatabase): void;
}

/**
 * Ordered, append-only schema history tracked by PRAGMA user_version.
 * Version 1 is the historical probe-and-ALTER baseline: it is idempotent, so a
 * pre-versioning database (user_version 0) upgrades cleanly whatever subset of
 * the legacy steps it already had. Never edit a shipped migration; append one.
 */
export const SCHEMA_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    name: 'baseline',
    up(db) {
      db.exec(INITIAL_SCHEMA_SQL);
      applyLegacyMigrations(db);
    },
  },
  {
    version: 2,
    name: 'list-and-retention-indexes',
    up(db) {
      db.exec(SCHEMA_V2_INDEXES_SQL);
    },
  },
];

export const LATEST_SCHEMA_VERSION = SCHEMA_MIGRATIONS[SCHEMA_MIGRATIONS.length - 1]!.version;

export interface ApplyMigrationsOptions {
  /**
   * Called once, before the first pending migration, when the database already
   * holds tables. Hosts copy the file aside here; a throw aborts the upgrade.
   */
  backup?: (fromVersion: number) => void;
}

export function readSchemaVersion(db: AppDatabase): number {
  const row = db.prepare('PRAGMA user_version').get();
  return Number(row?.user_version ?? 0) || 0;
}

function hasUserTables(db: AppDatabase): boolean {
  const row = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").get();
  return Number(row?.n ?? 0) > 0;
}

export function applyMigrations(db: AppDatabase, options: ApplyMigrationsOptions = {}): void {
  const fromVersion = readSchemaVersion(db);
  if (fromVersion > LATEST_SCHEMA_VERSION) {
    // Opened by an older build after a newer one upgraded the file. Additive
    // migrations keep this readable; refuse nothing, but make it visible.
    console.warn('[db] database schema is newer than this build', {
      databaseVersion: fromVersion,
      supportedVersion: LATEST_SCHEMA_VERSION,
    });
    return;
  }
  const pending = SCHEMA_MIGRATIONS.filter((migration) => migration.version > fromVersion);
  if (pending.length === 0) return;
  if (options.backup && hasUserTables(db)) options.backup(fromVersion);

  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      migration.up(db);
      // PRAGMA cannot be parameterized; the version is a trusted integer constant.
      db.exec(`PRAGMA user_version = ${Math.trunc(migration.version)}`);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Preserve the migration error. */ }
      console.error('[db] schema migration failed; the database was left at its previous version', {
        version: migration.version,
        name: migration.name,
        code: (error as { code?: unknown } | null)?.code,
      });
      throw error;
    }
  }
}
