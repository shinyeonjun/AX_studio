import { backup, DatabaseSync } from 'node:sqlite';
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
}

export type DatabaseBackup = (source: string, destination: string) => Promise<void>;

export interface DataMigrationDependencies {
  backupDatabase?: DatabaseBackup;
}

function readMigration(paths: AxDataPaths): MigrationRecord | null {
  if (!existsSync(paths.migration)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(paths.migration, 'utf8'));
  } catch {
    throw new Error(`AX Studio 저장소 마이그레이션 기록을 읽을 수 없습니다: ${paths.migration}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`AX Studio 저장소 마이그레이션 기록이 올바르지 않습니다: ${paths.migration}`);
  }
  const record = parsed as Partial<MigrationRecord>;
  if (record.storageLayoutVersion !== 1 || typeof record.migratedAt !== 'string') {
    throw new Error(`지원하지 않는 AX Studio 저장소 레이아웃입니다: ${paths.migration}`);
  }
  return record as MigrationRecord;
}

function writeMigration(paths: AxDataPaths): void {
  const record: MigrationRecord = {
    storageLayoutVersion: 1,
    migratedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(paths.migration), { recursive: true });
  const temporaryPath = `${paths.migration}.tmp-${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(record, null, 2), 'utf8');
    renameSync(temporaryPath, paths.migration);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
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
      throw new Error('SQLite snapshot이 생성되지 않았습니다.');
    }
    const snapshot = new DatabaseSync(temporaryPath, { readOnly: true });
    try {
      const checks = snapshot.prepare('PRAGMA quick_check').all();
      if (checks.length !== 1 || checks[0]?.quick_check !== 'ok') {
        throw new Error('SQLite snapshot 무결성 검사에 실패했습니다.');
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
}
