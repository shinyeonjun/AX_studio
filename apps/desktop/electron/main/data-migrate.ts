import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { AxDataPaths } from '@ax-studio/core';
import { legacyHomeDataRoot } from '@ax-studio/core';
import { legacyElectronUserDataDir, legacyHomeArtifactRoot } from './data-paths.js';

interface MigrationRecord {
  storageLayoutVersion: number;
  migratedAt: string;
  /** The user chose to continue without the legacy data; legacy files stay untouched. */
  legacySkipped?: boolean;
}

interface MigrationFailureRecord {
  failedAt: string;
  error: string;
  /** False when the failure left no database, so the one created afterwards is a fresh session's. */
  databaseExistedAtFailure: boolean;
}

export type DataMigrationOutcome = 'migrated' | 'continued_after_failure';

export interface DataMigrationUi {
  showMessageBox(options: Electron.MessageBoxOptions): Promise<Pick<Electron.MessageBoxReturnValue, 'response'>>;
}

type DatabaseBackup = (source: string, destination: string) => Promise<void>;

export interface DataMigrationDependencies {
  backupDatabase?: DatabaseBackup;
}

function readMigration(paths: AxDataPaths): MigrationRecord | null {
  if (!existsSync(paths.migration)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(paths.migration, 'utf8'));
  } catch {
    throw new Error(`데이터 이전 기록 파일을 읽을 수 없어요: ${paths.migration}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`데이터 이전 기록 파일이 손상됐어요: ${paths.migration}`);
  }
  const record = parsed as Partial<MigrationRecord>;
  if (record.storageLayoutVersion !== 1 || typeof record.migratedAt !== 'string') {
    throw new Error(`이 버전에서 읽을 수 없는 데이터 이전 기록이에요. 앱을 최신 버전으로 업데이트해 주세요: ${paths.migration}`);
  }
  return record as MigrationRecord;
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

function writeMigration(paths: AxDataPaths, options: { legacySkipped?: boolean } = {}): void {
  const record: MigrationRecord = {
    storageLayoutVersion: 1,
    migratedAt: new Date().toISOString(),
    ...(options.legacySkipped ? { legacySkipped: true } : {}),
  };
  writeJsonAtomic(paths.migration, record);
}

export function migrationFailurePath(paths: AxDataPaths): string {
  return `${paths.migration}.failed`;
}

function readMigrationFailure(paths: AxDataPaths): MigrationFailureRecord | null {
  const path = migrationFailurePath(paths);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<MigrationFailureRecord>;
    return { failedAt: String(parsed.failedAt ?? ''), error: String(parsed.error ?? ''),
      databaseExistedAtFailure: parsed.databaseExistedAtFailure !== false };
  } catch {
    // Unknown state: assume the database predates the failure and never move it.
    return { failedAt: '', error: '', databaseExistedAtFailure: true };
  }
}

/**
 * A previous launch failed to migrate and then ran on a fresh database. Move
 * that fresh database aside (never delete it) so the legacy snapshot can land.
 */
function setAsideFreshDatabaseAfterFailure(paths: AxDataPaths): void {
  const failure = readMigrationFailure(paths);
  if (!failure || failure.databaseExistedAtFailure || !existsSync(paths.database)) return;
  const target = `${paths.database}.fresh-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  renameSync(paths.database, target);
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(paths.database + suffix)) renameSync(paths.database + suffix, target + suffix);
  }
  console.warn('[AX Studio] moved the database created after a failed migration aside', { target });
}

function copyDirIfSourceExists(source: string, dest: string): void {
  if (!existsSync(source)) return;
  cpSync(source, dest, { recursive: true, force: false, errorOnExist: false });
}

function copyFileIfMissing(source: string, dest: string): void {
  if (!existsSync(source) || existsSync(dest)) return;
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(source, dest);
}

async function backupWithNativeSqlite(source: string, destination: string): Promise<void> {
  const { backup, DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, destination);
  } finally {
    db.close();
  }
}

async function backupDatabaseIfMissing(
  source: string,
  destination: string,
  backupDatabase: DatabaseBackup,
): Promise<void> {
  if (!existsSync(source) || existsSync(destination)) return;
  mkdirSync(dirname(destination), { recursive: true });
  const temporaryPath = `${destination}.migration-${randomUUID()}`;
  try {
    await backupDatabase(source, temporaryPath);
    if (!existsSync(temporaryPath) || !statSync(temporaryPath).isFile()) {
      throw new Error('이전 데이터의 사본을 만들지 못했어요.');
    }
    const { DatabaseSync } = await import('node:sqlite');
    const snapshot = new DatabaseSync(temporaryPath, { readOnly: true });
    try {
      const checks = snapshot.prepare('PRAGMA quick_check').all();
      if (checks.length !== 1 || checks[0]?.quick_check !== 'ok') {
        throw new Error('이전 데이터의 사본이 손상되어 쓸 수 없어요.');
      }
    } finally {
      snapshot.close();
    }
    renameSync(temporaryPath, destination);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

export async function migrateAxDataIfNeeded(
  paths: AxDataPaths,
  dependencies: DataMigrationDependencies = {},
): Promise<void> {
  if (readMigration(paths)) return;
  setAsideFreshDatabaseAfterFailure(paths);

  const legacyUserData = legacyElectronUserDataDir();
  const legacyHome = legacyHomeArtifactRoot();
  const legacyHomeRoot = legacyHomeDataRoot();

  await backupDatabaseIfMissing(
    join(legacyUserData, 'ax-studio.db'),
    paths.database,
    dependencies.backupDatabase ?? backupWithNativeSqlite,
  );
  copyDirIfSourceExists(join(legacyUserData, 'credentials'), paths.credentials);
  copyFileIfMissing(join(legacyUserData, 'ai.toml'), join(paths.config, 'ai.toml'));
  copyDirIfSourceExists(join(legacyHome, 'documents'), paths.documents);
  copyDirIfSourceExists(join(legacyHomeRoot, 'documents'), paths.documents);
  copyDirIfSourceExists(join(legacyHome, 'templates'), paths.templates);
  copyDirIfSourceExists(join(legacyHomeRoot, 'templates'), paths.templates);

  writeMigration(paths);
  rmSync(migrationFailurePath(paths), { force: true });
}

const defaultUi: DataMigrationUi = {
  async showMessageBox(options) {
    const { dialog } = await import('electron');
    return dialog.showMessageBox(options);
  },
};

/**
 * Startup wrapper: a failed legacy migration (corrupt snapshot, EBUSY/EPERM
 * copy) must not block every launch. Legacy files are never modified; the
 * failure is recorded and the app continues on the new data root. The user
 * chooses whether to retry on the next launch or to stop migrating.
 */
export async function migrateAxDataOrContinue(
  paths: AxDataPaths,
  dependencies: DataMigrationDependencies = {},
  ui: DataMigrationUi = defaultUi,
): Promise<DataMigrationOutcome> {
  try {
    await migrateAxDataIfNeeded(paths, dependencies);
    return 'migrated';
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error('[AX Studio] legacy data migration failed; continuing without it', error);
    if (existsSync(paths.migration)) {
      // The new root was already migrated but its record is unreadable: keep using it as-is.
      return 'continued_after_failure';
    }
    try {
      const previous = readMigrationFailure(paths);
      const record: MigrationFailureRecord = {
        failedAt: new Date().toISOString(),
        error: detail,
        // Once a fresh-session database has been recorded, keep treating it as such.
        databaseExistedAtFailure: previous?.databaseExistedAtFailure === false ? false : existsSync(paths.database),
      };
      writeJsonAtomic(migrationFailurePath(paths), record);
    } catch (recordError) {
      console.error('[AX Studio] could not record the migration failure', recordError);
    }
    let response = 0;
    try {
      ({ response } = await ui.showMessageBox({
        type: 'warning',
        title: 'AX Studio 데이터 이전 실패',
        message: '이전 버전의 데이터를 옮기지 못했습니다.',
        detail: `기존 데이터는 그대로 보존되어 있으며, 이번에는 새 데이터 위치로 시작합니다.

오류: ${detail}`,
        buttons: ['다음 실행 시 다시 시도', '이전 데이터 없이 계속 사용'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }));
    } catch (dialogError) {
      console.error('[AX Studio] could not show the migration failure dialog', dialogError);
    }
    if (response === 1) {
      try {
        writeMigration(paths, { legacySkipped: true });
        rmSync(migrationFailurePath(paths), { force: true });
      } catch (skipError) {
        console.error('[AX Studio] could not record the skipped migration', skipError);
      }
    }
    return 'continued_after_failure';
  }
}
