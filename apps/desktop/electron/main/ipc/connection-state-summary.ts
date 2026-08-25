import {
  getHttpConnectionStatus,
  getWebhookConnectionStatus,
  parseGmailConnectionConfig,
  parseHttpConnectionConfig,
  parseRdbConnectionConfig,
} from '@ax-studio/core';
import { getOsSecret } from '../credential-store.js';

const RDB_SECRET_NAME = 'rdb.connection-string';

function formatRdbTarget(
  config: Record<string, unknown>,
  connectionString: string | null,
): string | undefined {
  const type = config.type;
  if (type === 'sqlite' && typeof config.filePath === 'string') {
    return config.filePath;
  }

  const value =
    connectionString ??
    (typeof config.connectionString === 'string' ? config.connectionString.trim() : '');
  if (!value) {
    if (type === 'postgres') return 'PostgreSQL';
    if (type === 'mysql') return 'MySQL';
    return undefined;
  }

  try {
    const url = new URL(value);
    const host = url.hostname;
    const port = url.port ? `:${url.port}` : '';
    const db = url.pathname && url.pathname !== '/' ? url.pathname : '';
    return `${host}${port}${db}`;
  } catch {
    return undefined;
  }
}

export async function summarizeConnection(
  connector: string,
  connected: boolean,
  config: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  if (connector === 'gmail') {
    const gmail = parseGmailConnectionConfig(config);
    return {
      connector,
      connected,
      account: gmail?.account,
      scopes: gmail?.scopes,
    };
  }

  if (connector === 'http') {
    const status = getHttpConnectionStatus(config, connected);
    const record = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
    const parsed = parseHttpConnectionConfig(config);
    return {
      connector,
      connected: status.connected,
      label: status.label,
      baseUrl: status.baseUrl,
      authType: status.authType,
      authHeader: typeof record.authHeader === 'string' ? record.authHeader : undefined,
      username: parsed?.auth?.username ?? (typeof record.username === 'string' ? record.username : undefined),
    };
  }

  if (connector === 'webhook') {
    const status = getWebhookConnectionStatus(config, connected);
    return {
      connector,
      connected: status.connected,
      label: status.label,
      port: status.port,
      localBaseUrl: status.localBaseUrl,
      tunnelUrl: status.tunnelUrl,
    };
  }

  if (connector === 'rdb') {
    const record = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
    const storedConnectionString =
      connected && record.type !== 'sqlite' ? await getOsSecret(RDB_SECRET_NAME) : null;
    const parsed = parseRdbConnectionConfig(
      record.type === 'sqlite'
        ? config
        : storedConnectionString
          ? { ...record, connectionString: storedConnectionString }
          : config,
    );
    const isReady =
      connected &&
      parsed &&
      (parsed.type === 'sqlite' || record.connectionStringStored === true || Boolean(storedConnectionString));

    return {
      connector,
      connected: Boolean(isReady),
      label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
      dbType: parsed?.type,
      target: formatRdbTarget(record, storedConnectionString),
      connectionString:
        connected && parsed?.type !== 'sqlite' ? storedConnectionString ?? undefined : undefined,
      allowedSchemas: parsed?.allowedSchemas,
      allowedTables: parsed?.allowedTables,
      rowLimit: parsed?.rowLimit,
    };
  }

  return { connector, connected };
}

export async function summarizeConnections(
  connections: Array<{
    connector: string;
    connected: boolean;
    config?: Record<string, unknown>;
  }>,
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    connections.map(({ connector, connected, config }) => summarizeConnection(connector, connected, config)),
  );
}
