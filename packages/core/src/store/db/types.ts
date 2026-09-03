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
  close?(): void;
}
