export interface RdbConnectionRecord {
  type?: 'mysql' | 'postgres' | 'sqlite';
  connectionString?: string;
  connectionStringStored?: boolean;
  filePath?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
  label?: string;
  connectedAt?: string;
  lastError?: string;
}

export type RdbConnectionProbeResult =
  | { ok: true }
  | { ok: false; error: string; detail?: string };
