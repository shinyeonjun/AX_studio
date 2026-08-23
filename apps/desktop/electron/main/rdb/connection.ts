import {
  RdbConnector,
  parseRdbConnectionConfig,
  probeRdbConnection,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';

export async function hydrateRdbConnector(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  const connection = store.getConnections().find((entry) => entry.connector === 'rdb');
  if (!connection?.connected) return;

  const parsed = parseRdbConnectionConfig(connection.config);
  if (!parsed) {
    store.setConnection('rdb', false);
    return;
  }

  runtime.setConnector('rdb', new RdbConnector(parsed));
}

export async function validateAndConnectRdb(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: {
    type: 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
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
          allowedTables: payload.allowedTables,
          rowLimit: payload.rowLimit,
        }
      : {
          type: 'postgres' as const,
          connectionString: payload.connectionString?.trim() ?? '',
          allowedTables: payload.allowedTables,
          rowLimit: payload.rowLimit,
        };

  if (type === 'sqlite' && !config.filePath) {
    throw new Error('SQLite 파일 경로가 필요합니다.');
  }
  if (type === 'postgres' && !config.connectionString) {
    throw new Error('PostgreSQL connection string이 필요합니다.');
  }

  const probe = await probeRdbConnection(config);
  if (!probe.ok) {
    throw new Error(
      probe.error === 'postgres_connection_failed'
        ? 'PostgreSQL에 연결할 수 없습니다.'
        : 'SQLite 파일을 열 수 없습니다.',
    );
  }

  store.setConnection('rdb', true, {
    ...config,
    label: payload.label?.trim() || undefined,
    connectedAt: new Date().toISOString(),
    lastError: undefined,
  });
  runtime.setConnector('rdb', new RdbConnector(config));
}

export async function disconnectRdb(store: WorkflowStore, runtime: WorkflowRuntime): Promise<void> {
  store.setConnection('rdb', false);
  runtime.setConnector('rdb', null);
}
