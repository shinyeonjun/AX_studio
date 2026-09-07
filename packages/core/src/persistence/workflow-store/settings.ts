import type { AppDatabase } from '../db.js';
import * as settingsRepo from '../repositories/settings-repository.js';

export function getSetting<T>(db: AppDatabase, key: string, defaultValue: T): T {
  return settingsRepo.getSetting(db, key, defaultValue);
}

export function getGlobalActive(db: AppDatabase): boolean {
  return settingsRepo.getGlobalActive(db);
}

export function setSetting(db: AppDatabase, key: string, value: unknown) {
  settingsRepo.setSetting(db, key, value);
}

export function setConnection(
  db: AppDatabase,
  connector: string,
  connected: boolean,
  config?: Record<string, unknown>,
) {
  settingsRepo.setConnection(db, connector, connected, config);
}

export function getConnections(db: AppDatabase) {
  return settingsRepo.getConnections(db);
}
