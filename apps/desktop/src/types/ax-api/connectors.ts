export interface AxConnectorApi {
  connectSlack: (payload: string | { token: string; appToken?: string }) => Promise<unknown>;
  disconnectSlack: () => Promise<{ ok: boolean }>;
  connectGmailOAuth: () => Promise<{ ok: boolean; email?: string }>;
  disconnectGmailOAuth: () => Promise<{ ok: boolean }>;
  pickLocalFolder: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  addLocalFolder: (payload: { path: string; label?: string }) => Promise<unknown>;
  removeLocalFolder: (folderId: string) => Promise<unknown>;
  connectHttp: (payload: {
    endpointId?: string;
    baseUrl: string;
    label?: string;
    authType: 'none' | 'bearer' | 'apiKey' | 'basic';
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  }) => Promise<unknown>;
  disconnectHttp: (endpointId?: string) => Promise<unknown>;
  connectWebhook: (payload: {
    port: number;
    secret: string;
    label?: string;
    tunnelUrl?: string;
  }) => Promise<unknown>;
  disconnectWebhook: () => Promise<unknown>;
  pickSqliteFile: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  connectRdb: (payload: {
    type: 'mysql' | 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
    allowedSchemas?: string[];
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => Promise<unknown>;
  disconnectRdb: () => Promise<unknown>;
  connectOpenApi: (payload: {
    specId: string;
    label?: string;
    specUrl?: string;
    specJson?: string;
  }) => Promise<unknown>;
  disconnectOpenApi: () => Promise<unknown>;
  connectMcp: (payload: { serverId: string; label?: string; toolsJson: string }) => Promise<unknown>;
  disconnectMcp: () => Promise<unknown>;
}
