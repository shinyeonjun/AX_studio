import { parseRdbConnectionConfig, type RdbConnectionConfig } from '@ax-studio/core';
import { getRdbConnectionString } from './secrets.js';

export function persistedRdbConfig(config: RdbConnectionConfig): Record<string, unknown> {
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
