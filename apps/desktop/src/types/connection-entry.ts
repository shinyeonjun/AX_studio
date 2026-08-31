export type HttpAuthType = 'none' | 'bearer' | 'apiKey' | 'basic';
export type RdbType = 'sqlite' | 'postgres' | 'mysql';

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
  dbType?: RdbType;
  target?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
}
