import {
  RdbConnector,
  probeRdbConnection,
  summarizeRdbSchema,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { getRdbConnectionString, saveRdbConnectionString } from './secrets.js';
import { persistedRdbConfig } from './config.js';
import { rdbProbeErrorMessage, rdbProbeWarningMessage } from './probe-message.js';

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
): Promise<{ warning?: string }> {
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
    throw new Error('SQLite 파일을 먼저 선택해 주세요.');
  }
  if ((type === 'postgres' || type === 'mysql') && !config.connectionString) {
    const stored = await getRdbConnectionString();
    if (stored) {
      config.connectionString = stored;
    }
  }
  if ((type === 'postgres' || type === 'mysql') && !config.connectionString) {
    throw new Error(`${type === 'mysql' ? 'MySQL' : 'PostgreSQL'} 접속 주소를 입력해 주세요.`);
  }

  const probe = await probeRdbConnection(config);
  if (!probe.ok) {
    throw new Error(rdbProbeErrorMessage(probe));
  }

  if (config.type !== 'sqlite') {
    await saveRdbConnectionString(config.connectionString!);
  }

  // Columns and relations let the read catalog offer joined reads; without them reads still work.
  const schema = await summarizeRdbSchema(config).catch(() => undefined);
  store.setConnection('rdb', true, {
    ...persistedRdbConfig(config),
    ...(schema ? { schema } : {}),
    label: payload.label?.trim() || undefined,
    connectedAt: new Date().toISOString(),
    lastError: undefined,
  });
  runtime.setConnector('rdb', new RdbConnector(config));
  return probe.warning ? { warning: rdbProbeWarningMessage(probe.warning) } : {};
}
