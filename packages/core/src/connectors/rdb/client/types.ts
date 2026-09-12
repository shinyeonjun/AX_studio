export interface RdbConnectionConfig {
  type: 'mysql' | 'postgres' | 'sqlite';
  connectionString?: string;
  filePath?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
}

export interface RdbTableRef {
  schema?: string;
  table: string;
}

export interface RdbTableInfo extends RdbTableRef {}

export type QueryValue = string | number | boolean | null;
export type RdbRow = Record<string, unknown>;

export interface RdbSqlClient {
  query(sql: string, values?: QueryValue[]): Promise<RdbRow[]>;
  close(): Promise<void>;
}
