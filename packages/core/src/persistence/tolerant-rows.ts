import type { AppDatabase } from './db/types.js';

/** A persisted row that could not be decoded; never carries the payload itself. */
export interface CorruptRowReport {
  table: string;
  id: string;
  code: string;
  detectedAt: string;
}

const corruptRowsByDb = new WeakMap<AppDatabase, Map<string, CorruptRowReport>>();

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return error instanceof Error ? error.name : 'unknown_error';
}

export function recordCorruptRow(db: AppDatabase, table: string, id: string, error: unknown): void {
  const code = errorCode(error);
  let reports = corruptRowsByDb.get(db);
  if (!reports) {
    reports = new Map();
    corruptRowsByDb.set(db, reports);
  }
  const key = `${table}:${id}`;
  if (!reports.has(key)) {
    // Log identifiers and the error code only: row payloads may contain user data.
    console.warn('[persistence] skipped corrupt row', { table, id, code });
  }
  reports.set(key, { table, id, code, detectedAt: new Date().toISOString() });
}

/** Rows skipped by tolerant list reads since this database was opened. */
export function listCorruptRows(db: AppDatabase): CorruptRowReport[] {
  return [...(corruptRowsByDb.get(db)?.values() ?? [])];
}

/**
 * Maps rows one at a time so a single corrupt or schema-drifted row is skipped
 * (and reported) instead of failing the whole list. Single-row getters should
 * keep throwing their typed errors.
 */
export function mapRowsTolerant<R, T>(
  db: AppDatabase,
  table: string,
  rows: readonly R[],
  idOf: (row: R) => unknown,
  map: (row: R) => T,
): T[] {
  const mapped: T[] = [];
  for (const row of rows) {
    try {
      mapped.push(map(row));
    } catch (error) {
      recordCorruptRow(db, table, String(idOf(row)), error);
    }
  }
  return mapped;
}
