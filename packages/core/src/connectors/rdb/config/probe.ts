import { openRdbSqlClient } from '../client.js';
import type { RdbConnectionConfig } from '../connector.js';
import type { RdbConnectionProbeResult } from './contracts.js';
import { rdbTransportWarning, validateRdbConnectionString } from './validate.js';

function safeProbeError(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (!message) return undefined;
  return message
    .replace(/((?:postgres(?:ql)?|mysql):\/\/)[^\s]+/gi, '$1<redacted>')
    .slice(0, 240);
}

export async function probeRdbConnection(config: RdbConnectionConfig): Promise<RdbConnectionProbeResult> {
  if (config.type === 'sqlite' && config.filePath) {
    try {
      const { openReadonlySqlite } = await import('../../../persistence/db.js');
      const db = await openReadonlySqlite(config.filePath);
      try {
        db.all("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1");
      } finally {
        db.close();
      }
      return { ok: true };
    } catch {
      return { ok: false, error: 'sqlite_file_unreadable' };
    }
  }

  if ((config.type === 'postgres' || config.type === 'mysql') && config.connectionString) {
    const formatError = validateRdbConnectionString(config.type, config.connectionString);
    if (formatError) {
      return { ok: false, error: formatError };
    }
    let client: Awaited<ReturnType<typeof openRdbSqlClient>> | undefined;
    try {
      client = await openRdbSqlClient(config);
      await client.query('SELECT 1');
      const warning = rdbTransportWarning(config.type, config.connectionString);
      if (warning) {
        console.warn('[rdb] connected to a non-local database without TLS; credentials and rows travel in plaintext.');
        return { ok: true, warning };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: config.type === 'mysql' ? 'mysql_connection_failed' : 'postgres_connection_failed',
        detail: safeProbeError(error),
      };
    } finally {
      await client?.close().catch(() => undefined);
    }
  }

  return { ok: false, error: 'invalid_rdb_config' };
}
