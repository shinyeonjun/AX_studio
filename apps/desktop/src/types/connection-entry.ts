export type HttpAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';
type RdbType = 'sqlite' | 'postgres' | 'mysql';

export interface ConnectionEntry {
  connector: string;
  connected: boolean;
  account?: string;
  scopes?: string[];
  label?: string;
  baseUrl?: string;
  authType?: HttpAuthType;
  authHeader?: string;
  username?: string;
  endpoints?: Array<{
    id: string;
    baseUrl: string;
    label?: string;
    authType?: HttpAuthType;
    authHeader?: string;
    username?: string;
  }>;
  port?: number;
  localBaseUrl?: string;
  tunnelUrl?: string;
  listenerStatus?: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  lastError?: string;
  dbType?: RdbType;
  target?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
  /** Every database of the 'rdb' connection; the flat fields above mirror the first one. */
  databases?: Array<{
    id: string;
    label?: string;
    dbType?: RdbType;
    target?: string;
    allowedSchemas?: string[];
    allowedTables?: string[];
    rowLimit?: number;
    /** Saved, but its address is missing from this computer's secure storage. */
    needsReconnect?: boolean;
  }>;
}
