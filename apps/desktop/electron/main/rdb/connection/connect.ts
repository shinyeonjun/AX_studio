import {
  RdbConnector,
  probeRdbConnection,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { getRdbConnectionString, saveRdbConnectionString } from './secrets.js';
import { persistedRdbConfig } from './config.js';
import { rdbProbeErrorMessage } from './probe-message.js';

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
