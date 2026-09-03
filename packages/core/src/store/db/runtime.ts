import { createNativeDatabase, openReadonlyNativeSqlite } from '../db-native.js';
import { applyMigrations } from './schema.js';
import {
  createSqlJsDatabase,
  openReadonlySqlJs,
} from './sqljs.js';
import type { AppDatabase } from './types.js';

function shouldUseSqlJsBackend(): boolean {
  return process.env.AX_DB_BACKEND === 'sqljs';
}

function logDatabaseFallback(message: string, hint: string, error: unknown): void {
  if (process.env.AX_DEBUG_DB !== '1') return;
  const detail = error instanceof Error ? error.message : String(error);
  console.warn('[db] ' + message + '.' + hint + ' ' + detail);
}

/** @deprecated Use createDatabaseAsync(). sql.js init is async in all environments. */
export function createDatabase(_path: string): AppDatabase {
  throw new Error('Use createDatabaseAsync() — sync database init is no longer supported.');
}

export async function createDatabaseAsync(path: string): Promise<AppDatabase> {
  if (!shouldUseSqlJsBackend()) {
    try {
      const adapter = createNativeDatabase(path);
      applyMigrations(adapter);
      return adapter;
    } catch (error) {
      const hint =
        typeof process.versions.electron === 'string'
          ? ' Run \u0060npm run ensure:native -w @ax-studio/desktop\u0060 (or \u0060npm run dev\u0060, which runs it automatically).'
          : '';
      logDatabaseFallback('better-sqlite3 unavailable; using sql.js', hint, error);
    }
  }
  return createSqlJsDatabase(path);
}

export async function openReadonlySqlite(filePath: string): Promise<{
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
}> {
  if (!shouldUseSqlJsBackend()) {
    try {
      return openReadonlyNativeSqlite(filePath);
    } catch (error) {
      const hint =
        typeof process.versions.electron === 'string'
          ? ' Run \u0060npm run ensure:native -w @ax-studio/desktop\u0060.'
          : '';
      logDatabaseFallback('better-sqlite3 readonly open failed; using sql.js', hint, error);
    }
  }

  return openReadonlySqlJs(filePath);
}
