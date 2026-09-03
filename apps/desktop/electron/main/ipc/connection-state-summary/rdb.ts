import { getOsSecret } from '../../credential-store.js';
import { parseRdbConnectionConfig } from '@ax-studio/core';

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

export async function summarizeRdbConnection(
  connected: boolean,
  config: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
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
    connector: 'rdb',
    connected: Boolean(isReady),
    label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
    dbType: parsed?.type,
    target: formatRdbTarget(record, storedConnectionString),
    allowedSchemas: parsed?.allowedSchemas,
    allowedTables: parsed?.allowedTables,
    rowLimit: parsed?.rowLimit,
  };
}
