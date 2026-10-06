import { applyMigrations, type ApplyMigrationsOptions } from './schema.js';
import { writeMigrationBackup } from './backup.js';
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
  applyMigrations?: (database: AppDatabase, options?: ApplyMigrationsOptions) => void;
}

function shouldUseSqlJsBackend(): boolean {
  return process.env.AX_DB_BACKEND === 'sqljs';
}

const loggedFallbacks = new Set<string>();

export interface DatabaseBackendStatus {
  backend: 'native' | 'sqljs';
  /** True when native SQLite was wanted but unavailable (not an explicit AX_DB_BACKEND=sqljs). */
  fallback: boolean;
  reason?: string;
}

let backendStatus: DatabaseBackendStatus | undefined;

/** Backend chosen by the most recent writable open; hosts surface `fallback` to the user. */
export function getDatabaseBackendStatus(): DatabaseBackendStatus | undefined {
  return backendStatus ? { ...backendStatus } : undefined;
}

function describeFallback(error: unknown): string {
  const rawDetail = error instanceof Error ? error.message : String(error);
  return /Could not locate the bindings file/.test(rawDetail)
    ? 'native binding is not installed'
    : /compiled against a different Node\.js version|Module did not self-register/.test(rawDetail)
      ? 'native binding ABI is incompatible'
      : rawDetail;
}

function logDatabaseFallback(message: string, hint: string, detail: string): void {
  const key = `${message}:${detail}`;
  if (loggedFallbacks.has(key)) return;
  loggedFallbacks.add(key);
  // Loud and structured: sql.js keeps the whole database in memory and
  // persists debounced full-file snapshots, which is a real durability downgrade.
  console.warn('[db] ' + message + '.' + hint + ' ' + detail, {
    event: 'database_backend_fallback',
    backend: 'sqljs',
    reason: detail,
  });
}

function isNativeBackendUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code === 'MODULE_NOT_FOUND' ||
    candidate.code === 'ERR_MODULE_NOT_FOUND' ||
    candidate.code === 'ERR_DLOPEN_FAILED' ||
    candidate.code === 'ERR_LOAD_FAILED') return true;
  return typeof candidate.message === 'string' &&
    (/Cannot find module|Could not locate the bindings file|compiled against a different Node\.js version/).test(candidate.message);
}

export async function createDatabaseAsync(
  path: string,
  dependencies: DatabaseRuntimeDependencies = {},
): Promise<AppDatabase> {
  let fallbackReason: string | undefined;
  if (!shouldUseSqlJsBackend()) {
    let adapter: AppDatabase | undefined;
    try {
      const createNativeDatabase = dependencies.createNativeDatabase
        ?? (await import('../db-native.js')).createNativeDatabase;
      adapter = createNativeDatabase(path);
      const native = adapter;
      (dependencies.applyMigrations ?? applyMigrations)(native, path === ':memory:' ? {} : {
        // VACUUM INTO captures committed WAL content, unlike a raw file copy.
        backup: (fromVersion) => writeMigrationBackup(path, fromVersion, (target) => {
          native.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
        }),
      });
      backendStatus = { backend: 'native', fallback: false };
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
      const reason = describeFallback(error);
      logDatabaseFallback('better-sqlite3 unavailable; using sql.js', hint, reason);
      fallbackReason = reason;
    }
  }
  const createSqlJsDatabase = dependencies.createSqlJsDatabase
    ?? (await import('./sqljs.js')).createSqlJsDatabase;
  const database = await createSqlJsDatabase(path);
  backendStatus = { backend: 'sqljs', fallback: fallbackReason !== undefined, ...(fallbackReason ? { reason: fallbackReason } : {}) };
  return database;
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
      const openReadonlyNativeSqlite = dependencies.openReadonlyNativeSqlite
        ?? (await import('../db-native.js')).openReadonlyNativeSqlite;
      return openReadonlyNativeSqlite(filePath);
    } catch (error) {
      if (!isNativeBackendUnavailable(error)) throw error;
      const hint =
        typeof process.versions.electron === 'string'
          ? ' If native SQLite is required, set AX_NATIVE_DB_BUILD=1 before running npm run ensure:native -w @ax-studio/desktop.'
          : '';
      logDatabaseFallback('better-sqlite3 readonly open failed; using sql.js', hint, describeFallback(error));
    }
  }

  const openReadonlySqlJs = dependencies.openReadonlySqlJs
    ?? (await import('./sqljs.js')).openReadonlySqlJs;
  return openReadonlySqlJs(filePath);
}
