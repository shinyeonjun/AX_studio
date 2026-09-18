import { createNativeDatabase, openReadonlyNativeSqlite } from '../db-native.js';
import { applyMigrations } from './schema.js';
import {
  createSqlJsDatabase,
  openReadonlySqlJs,
} from './sqljs.js';
import type { AppDatabase } from './types.js';

export interface DatabaseRuntimeDependencies {
  createNativeDatabase?: (path: string) => AppDatabase;
  createSqlJsDatabase?: (path: string) => Promise<AppDatabase>;
  openReadonlyNativeSqlite?: (path: string) => {
    all(sql: string, params?: unknown[]): Record<string, unknown>[];
    close(): void;
  };
  openReadonlySqlJs?: (path: string) => Promise<{
    all(sql: string, params?: unknown[]): Record<string, unknown>[];
    close(): void;
  }>;
  applyMigrations?: (database: AppDatabase) => void;
}

function shouldUseSqlJsBackend(): boolean {
  return process.env.AX_DB_BACKEND === 'sqljs';
}

const loggedFallbacks = new Set<string>();

function logDatabaseFallback(message: string, hint: string, error: unknown): void {
  const rawDetail = error instanceof Error ? error.message : String(error);
  const detail = /Could not locate the bindings file/.test(rawDetail)
    ? 'native binding is not installed'
    : /compiled against a different Node\.js version|Module did not self-register/.test(rawDetail)
      ? 'native binding ABI is incompatible'
      : rawDetail;
  const key = `${message}:${detail}`;
  if (loggedFallbacks.has(key)) return;
  loggedFallbacks.add(key);
  console.warn('[db] ' + message + '.' + hint + ' ' + detail);
}

export function isNativeBackendUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 'MODULE_NOT_FOUND' ||
    candidate.code === 'ERR_MODULE_NOT_FOUND' ||
    candidate.code === 'ERR_DLOPEN_FAILED' ||
    candidate.code === 'ERR_LOAD_FAILED') return true;
  return typeof candidate.message === 'string' &&
    (/Cannot find module|Could not locate the bindings file|compiled against a different Node\.js version/).test(candidate.message);
}

/** @deprecated Use createDatabaseAsync(). sql.js init is async in all environments. */
export function createDatabase(_path: string): AppDatabase {
  throw new Error('Use createDatabaseAsync() — sync database init is no longer supported.');
}

export async function createDatabaseAsync(
  path: string,
  dependencies: DatabaseRuntimeDependencies = {},
): Promise<AppDatabase> {
  if (!shouldUseSqlJsBackend()) {
    let adapter: AppDatabase | undefined;
    try {
      adapter = (dependencies.createNativeDatabase ?? createNativeDatabase)(path);
      (dependencies.applyMigrations ?? applyMigrations)(adapter);
      return adapter;
    } catch (error) {
      try {
        adapter?.close?.();
      } catch {
        // Preserve the original database or migration error.
      }
      if (!isNativeBackendUnavailable(error)) throw error;
      const hint =
        typeof process.versions.electron === 'string'
          ? ' If native SQLite is required, set AX_NATIVE_DB_BUILD=1 before running npm run ensure:native -w @ax-studio/desktop.'
          : '';
      logDatabaseFallback('better-sqlite3 unavailable; using sql.js', hint, error);
    }
  }
  return (dependencies.createSqlJsDatabase ?? createSqlJsDatabase)(path);
}

export async function openReadonlySqlite(
  filePath: string,
  dependencies: DatabaseRuntimeDependencies = {},
): Promise<{
  all(sql: string, params?: unknown[]): Record<string, unknown>[];
  close(): void;
}> {
  if (!shouldUseSqlJsBackend()) {
    try {
      return (dependencies.openReadonlyNativeSqlite ?? openReadonlyNativeSqlite)(filePath);
    } catch (error) {
      if (!isNativeBackendUnavailable(error)) throw error;
      const hint =
        typeof process.versions.electron === 'string'
          ? ' If native SQLite is required, set AX_NATIVE_DB_BUILD=1 before running npm run ensure:native -w @ax-studio/desktop.'
          : '';
      logDatabaseFallback('better-sqlite3 readonly open failed; using sql.js', hint, error);
    }
  }

  return (dependencies.openReadonlySqlJs ?? openReadonlySqlJs)(filePath);
}
