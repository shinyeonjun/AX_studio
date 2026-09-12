export interface SqlRunResult {
  changes: number;
}

export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult;
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
}

export interface AppDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  /** Persist deferred writes before an irreversible external action. Native commits are synchronous. */
  flush?(): void;
  close?(): void;
}

/**
 * Database adapters intentionally return untyped rows. Keep the boundary cast
 * in one place so repositories declare their row shape at the query site.
 */
export function readRow<T>(statement: SqlStatement, ...params: unknown[]): T | undefined {
  return statement.get(...params) as unknown as T | undefined;
}

export function readRows<T>(statement: SqlStatement, ...params: unknown[]): T[] {
  return statement.all(...params) as unknown as T[];
}
