import { parseRdbConnectionConfig, rdbDatabaseEntries, type RdbDatabaseEntry } from '@ax-studio/core';
import { legacyPlaintextConnectionString } from '../../rdb/connection/config.js';
import { readRdbSecrets, type RdbDatabaseSecrets } from '../../rdb/connection/secrets.js';

function formatRdbTarget(entry: RdbDatabaseEntry, connectionString: string | undefined): string | undefined {
  if (entry.type === 'sqlite' && entry.filePath) {
    return entry.filePath;
  }

  if (!connectionString) {
    if (entry.type === 'postgres') return 'PostgreSQL';
    if (entry.type === 'mysql') return 'MySQL';
    return undefined;
  }

  try {
    const url = new URL(connectionString);
    const host = url.hostname;
    const port = url.port ? `:${url.port}` : '';
    const db = url.pathname && url.pathname !== '/' ? url.pathname : '';
    return `${host}${port}${db}`;
  } catch {
    return undefined;
  }
}

/** An unreadable stored secret reads as missing so the state request never rejects. */
async function readStoredConnectionStrings(): Promise<RdbDatabaseSecrets> {
  try {
    return await readRdbSecrets();
  } catch (error) {
    console.warn('[AX Studio] stored RDB secret unavailable', { code: (error as { code?: unknown } | null)?.code });
    return {};
  }
}

export async function summarizeRdbConnection(
  connected: boolean,
  config: Record<string, unknown> | undefined,
): Promise<Record<string, unknown>> {
  const entries = rdbDatabaseEntries(config).filter((entry) => entry.type !== undefined);
  const secrets = connected && entries.some((entry) => entry.type !== 'sqlite') ? await readStoredConnectionStrings() : {};
  const plaintext = legacyPlaintextConnectionString(config);

  // Connection strings stay in the main process; the renderer gets only host/port/database.
  const databases = entries.map((entry) => {
    const connectionString = entry.type === 'sqlite'
      ? undefined
      : secrets[entry.id]?.connectionString ?? (entries.length === 1 ? plaintext : undefined);
    const parsed = parseRdbConnectionConfig({ ...entry, ...(connectionString ? { connectionString } : {}) });
    const ready = connected && Boolean(parsed);
    return {
      id: entry.id,
      label: entry.label,
      dbType: entry.type,
      target: formatRdbTarget(entry, connectionString),
      allowedSchemas: parsed?.allowedSchemas ?? entry.allowedSchemas,
      allowedTables: parsed?.allowedTables ?? entry.allowedTables,
      rowLimit: parsed?.rowLimit ?? entry.rowLimit,
      // Saved, but its address is not in this computer's secure storage: connect it again.
      ...(ready ? {} : { needsReconnect: true }),
    };
  });
  // Legacy flat fields mirror the first usable database.
  const first = databases.find((database) => !database.needsReconnect) ?? databases[0];

  return {
    connector: 'rdb',
    connected: databases.some((database) => !database.needsReconnect),
    label: first?.label,
    dbType: first?.dbType,
    target: first?.target,
    allowedSchemas: first?.allowedSchemas,
    allowedTables: first?.allowedTables,
    rowLimit: first?.rowLimit,
    databases,
  };
}
