import { discoverRdbTables, formatRdbTableRef, probeRdbConnection, type RdbConnectionConfig } from '@ax-studio/core';
import { readRdbSecrets } from './secrets.js';
import { rdbProbeErrorMessage } from './probe-message.js';

/** More than this is a database to search, not a list to scroll; the rest stay typeable. */
export const MAX_DISCOVERED_TABLES = 1_000;

export interface DiscoveredRdbTables {
  tables: string[];
  truncated: boolean;
}

/**
 * The table names a database shows, so the person connecting it picks the allowed ones.
 * Nothing is saved and no connector changes: the allowlist is still only what they pick.
 */
export async function discoverRdbTableNames(payload: {
  type: RdbConnectionConfig['type'];
  filePath?: string;
  connectionString?: string;
  /** The database being edited: a blank address uses the one stored for it. */
  databaseId?: string;
}): Promise<DiscoveredRdbTables> {
  const typed = payload.connectionString?.trim();
  const databaseId = payload.databaseId?.trim();
  const stored = payload.type !== 'sqlite' && !typed && databaseId
    ? (await readRdbSecrets())[databaseId]?.connectionString
    : undefined;
  const config: RdbConnectionConfig = payload.type === 'sqlite'
    ? { type: 'sqlite', filePath: payload.filePath }
    : { type: payload.type, connectionString: typed || stored || '' };
  if (config.type === 'sqlite' ? !config.filePath : !config.connectionString) {
    throw new Error(config.type === 'sqlite' ? 'SQLite 파일을 먼저 선택해 주세요.' : '접속 주소를 먼저 입력해 주세요.');
  }
  const probe = await probeRdbConnection(config);
  if (!probe.ok) throw new Error(rdbProbeErrorMessage(probe));
  const tables = (await discoverRdbTables(config)).map((table) => formatRdbTableRef(table));
  return { tables: tables.slice(0, MAX_DISCOVERED_TABLES), truncated: tables.length > MAX_DISCOVERED_TABLES };
}
