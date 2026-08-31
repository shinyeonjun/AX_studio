import { copyFileSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AxDataPaths } from '@ax-studio/core';
import { legacyHomeDataRoot } from '@ax-studio/core';
import { legacyElectronUserDataDir, legacyHomeArtifactRoot } from './data-paths.js';

interface MigrationRecord {
  storageLayoutVersion: number;
  migratedAt: string;
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
  writeFileSync(paths.migration, JSON.stringify(record, null, 2), 'utf8');
}

function copyDirIfSourceExists(source: string, dest: string): void {
  if (!existsSync(source)) return;
  cpSync(source, dest, { recursive: true, force: false, errorOnExist: false });
}

function copyFileIfMissing(source: string, dest: string): void {
  if (!existsSync(source) || existsSync(dest)) return;
  copyFileSync(source, dest);
}

export function migrateAxDataIfNeeded(paths: AxDataPaths): void {
  if (readMigration(paths)) return;

  const legacyUserData = legacyElectronUserDataDir();
  const legacyHome = legacyHomeArtifactRoot();
  const legacyHomeRoot = legacyHomeDataRoot();

  copyFileIfMissing(join(legacyUserData, 'ax-studio.db'), paths.database);
  copyDirIfSourceExists(join(legacyUserData, 'credentials'), paths.credentials);
  copyFileIfMissing(join(legacyUserData, 'ai.toml'), join(paths.config, 'ai.toml'));
  copyDirIfSourceExists(join(legacyHome, 'documents'), paths.documents);
  copyDirIfSourceExists(join(legacyHomeRoot, 'documents'), paths.documents);
  copyDirIfSourceExists(join(legacyHome, 'templates'), paths.templates);
  copyDirIfSourceExists(join(legacyHomeRoot, 'templates'), paths.templates);

  writeMigration(paths);
}
