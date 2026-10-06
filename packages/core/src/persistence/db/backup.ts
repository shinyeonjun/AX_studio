import { existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

/** Pre-migration copies kept next to the database: `<db>.bak-v<old version>`. */
const KEPT_MIGRATION_BACKUPS = 2;

export function migrationBackupPath(dbPath: string, fromVersion: number): string {
  return `${dbPath}.bak-v${fromVersion}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Removes all but the newest `keep` migration backups of this database. */
export function pruneMigrationBackups(dbPath: string, keep = KEPT_MIGRATION_BACKUPS): void {
  const directory = dirname(dbPath);
  const pattern = new RegExp(`^${escapeRegExp(basename(dbPath))}\\.bak-v(\\d+)$`);
  let entries: Array<{ path: string; version: number }>;
  try {
    entries = readdirSync(directory).flatMap((name) => {
      const match = pattern.exec(name);
      return match ? [{ path: join(directory, name), version: Number(match[1]) }] : [];
    });
  } catch {
    return;
  }
  // Versions only grow, so the highest source version is the newest backup.
  entries.sort((left, right) => right.version - left.version);
  for (const stale of entries.slice(keep)) {
    try { rmSync(stale.path, { force: true }); }
    catch { /* A stale backup must never block startup. */ }
  }
}

/**
 * Writes a pre-migration backup through a temporary file so a crash never
 * leaves a truncated `.bak-v*` that looks complete. `write` must create the
 * file it is given (e.g. VACUUM INTO or a byte copy).
 */
export function writeMigrationBackup(dbPath: string, fromVersion: number, write: (targetPath: string) => void): string {
  const target = migrationBackupPath(dbPath, fromVersion);
  const temporary = `${target}.tmp`;
  rmSync(temporary, { force: true });
  try {
    write(temporary);
    if (!existsSync(temporary)) throw new Error('backup file was not created');
    renameSync(temporary, target);
  } catch (cause) {
    try { rmSync(temporary, { force: true }); } catch { /* Preserve the backup error. */ }
    throw Object.assign(new Error(`database_backup_failed: ${target}`, { cause }), { code: 'database_backup_failed' });
  }
  pruneMigrationBackups(dbPath);
  return target;
}

/**
 * Moves a corrupt database (and its WAL/SHM sidecars) aside so the user's data
 * is never overwritten or silently dropped; returns the new main-file path.
 */
export function quarantineCorruptDatabase(dbPath: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = `${dbPath}.corrupt-${stamp}`;
  renameSync(dbPath, target);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(dbPath + suffix)) {
      try { renameSync(dbPath + suffix, target + suffix); }
      catch { /* The main file is already preserved; a sidecar left behind is reported by its absence. */ }
    }
  }
  return target;
}
