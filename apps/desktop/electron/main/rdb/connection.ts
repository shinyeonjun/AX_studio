import {
  RdbConnector,
  parseRdbConnectionConfig,
  probeRdbConnection,
  type RdbConnectionConfig,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { deleteOsSecret, getOsSecret, setOsSecret } from '../credential-store.js';

const RDB_SECRET_NAME = 'rdb.connection-string';

async function getRdbConnectionString(): Promise<string | null> {
  const value = await getOsSecret(RDB_SECRET_NAME);
  return value?.trim() || null;
}

async function saveRdbConnectionString(value: string): Promise<void> {
  await setOsSecret(RDB_SECRET_NAME, value);
}

function persistedRdbConfig(config: RdbConnectionConfig): Record<string, unknown> {
  if (config.type === 'sqlite') {
    return {
      type: config.type,
      filePath: config.filePath,
      allowedSchemas: config.allowedSchemas,
      allowedTables: config.allowedTables,
      rowLimit: config.rowLimit,
    };
  }
  return {
    type: config.type,
    connectionStringStored: true,
    allowedSchemas: config.allowedSchemas,
    allowedTables: config.allowedTables,
    rowLimit: config.rowLimit,
  };
}

/** Resolves the persisted metadata with the encrypted connection string. */
export async function resolveRdbConnectionConfig(config: unknown): Promise<RdbConnectionConfig | null> {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as Record<string, unknown>;
  const type = record.type;
  if (type !== 'mysql' && type !== 'postgres' && type !== 'sqlite') return null;
  if (type === 'sqlite') return parseRdbConnectionConfig(config);

  const stored = await getRdbConnectionString();
  if (stored) {
    return parseRdbConnectionConfig({ ...record, connectionString: stored });
  }
  return parseRdbConnectionConfig(config);
}

export async function hydrateRdbConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'rdb');
  if (!connection?.connected) return;

  const metadata = (connection.config ?? {}) as Record<string, unknown>;
  const storedConnectionString = await getRdbConnectionString();
  const parsed = await resolveRdbConnectionConfig(connection.config);
  if (!parsed) {
    store.setConnection('rdb', false);
    return;
  }

  if (parsed.type !== 'sqlite' && typeof metadata.connectionString === 'string') {
    if (!storedConnectionString) {
      await saveRdbConnectionString(metadata.connectionString);
    }
    store.setConnection('rdb', true, {
      ...persistedRdbConfig(parsed),
      label: typeof metadata.label === 'string' ? metadata.label : undefined,
      connectedAt: typeof metadata.connectedAt === 'string' ? metadata.connectedAt : undefined,
      lastError: typeof metadata.lastError === 'string' ? metadata.lastError : undefined,
    });
  }

  runtime.setConnector('rdb', new RdbConnector(parsed));
}

function rdbProbeErrorMessage(probe: { error: string; detail?: string }): string {
  const detail = probe.detail ? ` (${probe.detail})` : '';
  switch (probe.error) {
    case 'invalid_postgres_connection_string':
      return 'PostgreSQL connection string 형식이 올바르지 않습니다. postgresql://user:pass@host:5432/db 형식을 사용해 주세요.';
    case 'invalid_mysql_connection_string':
      return 'MySQL connection string 형식이 올바르지 않습니다. mysql://user:pass@host:3306/db 형식을 사용해 주세요.';
    case 'invalid_connection_string':
      return 'connection string 형식이 올바르지 않습니다.';
    case 'empty_connection_string':
      return 'connection string이 필요합니다.';
    case 'postgres_connection_failed':
      return `PostgreSQL에 연결할 수 없습니다.${detail}`;
    case 'mysql_connection_failed':
      return `MySQL에 연결할 수 없습니다.${detail}`;
    default:
      return `SQLite 파일을 열 수 없습니다.${detail}`;
  }
}

export async function validateAndConnectRdb(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: {
    type: 'mysql' | 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
    allowedSchemas?: string[];
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  },
): Promise<void> {
  const type = payload.type;
  const config =
    type === 'sqlite'
      ? {
          type: 'sqlite' as const,
          filePath: payload.filePath?.trim() ?? '',
          allowedSchemas: payload.allowedSchemas,
          allowedTables: payload.allowedTables,
          rowLimit: payload.rowLimit,
        }
      : {
          type,
          connectionString: payload.connectionString?.trim() ?? '',
          allowedSchemas: payload.allowedSchemas,
          allowedTables: payload.allowedTables,
          rowLimit: payload.rowLimit,
        };

  if (type === 'sqlite' && !config.filePath) {
    throw new Error('SQLite 파일 경로가 필요합니다.');
  }
  if ((type === 'postgres' || type === 'mysql') && !config.connectionString) {
    const stored = await getRdbConnectionString();
    if (stored) {
      config.connectionString = stored;
    }
  }
  if ((type === 'postgres' || type === 'mysql') && !config.connectionString) {
    throw new Error(`${type === 'mysql' ? 'MySQL' : 'PostgreSQL'} connection string이 필요합니다.`);
  }

  const probe = await probeRdbConnection(config);
  if (!probe.ok) {
    throw new Error(rdbProbeErrorMessage(probe));
  }

  if (config.type !== 'sqlite') {
    await saveRdbConnectionString(config.connectionString!);
  }

  store.setConnection('rdb', true, {
    ...persistedRdbConfig(config),
    label: payload.label?.trim() || undefined,
    connectedAt: new Date().toISOString(),
    lastError: undefined,
  });
  runtime.setConnector('rdb', new RdbConnector(config));
}

export async function disconnectRdb(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  await deleteOsSecret(RDB_SECRET_NAME);
  store.setConnection('rdb', false);
  runtime.setConnector('rdb', null);
}
