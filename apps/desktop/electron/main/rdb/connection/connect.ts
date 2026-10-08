import {
  DEFAULT_RDB_DATABASE_ID,
  probeRdbConnection,
  rdbDatabaseEntries,
  rdbDatabaseName,
  summarizeRdbSchema,
  upsertRdbDatabase,
  type RdbConnectionConfig,
  type RdbDatabaseEntry,
  type WorkflowRuntime,
  type WorkflowStore,
} from '@ax-studio/core';
import { randomUUID } from 'node:crypto';
import { applyRdbConnector } from './apply.js';
import { withRdbConnectionLock } from './lock.js';
import { readRdbSecrets, writeRdbSecrets, type RdbDatabaseSecrets } from './secrets.js';
import { rdbProbeErrorMessage, rdbProbeWarningMessage } from './probe-message.js';

export interface RdbConnectionPayload {
  /** The database being edited; absent when adding one. */
  databaseId?: string;
  type: 'mysql' | 'postgres' | 'sqlite';
  connectionString?: string;
  filePath?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
  label?: string;
}

export interface RdbConnectResult {
  databaseId: string;
  label?: string;
  warning?: string;
}

/** The same server, user and database, whatever the password or option order. */
function sameRdbTarget(left: string, right: string): boolean {
  try {
    const a = new URL(left);
    const b = new URL(right);
    return a.protocol === b.protocol
      && a.username === b.username
      && a.hostname.toLowerCase() === b.hostname.toLowerCase()
      && a.port === b.port
      && a.pathname === b.pathname;
  } catch {
    return left.trim() === right.trim();
  }
}

function sameDatabase(entry: RdbDatabaseEntry, config: RdbConnectionConfig, secrets: RdbDatabaseSecrets): boolean {
  if (entry.type !== config.type) return false;
  if (config.type === 'sqlite') return Boolean(entry.filePath) && entry.filePath === config.filePath;
  const stored = secrets[entry.id]?.connectionString;
  return Boolean(stored && config.connectionString && sameRdbTarget(stored, config.connectionString));
}

/** A name for a database added without one, so several stay tellable apart. */
function defaultRdbLabel(id: string, config: RdbConnectionConfig): string {
  if (config.type !== 'sqlite' && config.connectionString) {
    try {
      const url = new URL(config.connectionString);
      const database = url.pathname.replace(/^\/+/u, '');
      return `${config.type === 'mysql' ? 'MySQL' : 'PostgreSQL'} ${database || url.hostname}`;
    } catch {
      // Falls through to the generic name.
    }
  }
  return rdbDatabaseName({ id, type: config.type, filePath: config.filePath });
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function validateAndConnectRdb(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: RdbConnectionPayload,
): Promise<RdbConnectResult> {
  return withRdbConnectionLock(() => connectRdbLocked(store, runtime, payload));
}

async function connectRdbLocked(
  store: WorkflowStore,
  runtime: WorkflowRuntime,
  payload: RdbConnectionPayload,
): Promise<RdbConnectResult> {
  const type = payload.type;
  const config: RdbConnectionConfig =
    type === 'sqlite'
      ? {
          type: 'sqlite',
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

  const connection = store.getConnections().find((entry) => entry.connector === 'rdb');
  const existing = rdbDatabaseEntries(connection?.config);
  const secrets = await readRdbSecrets();
  const requestedId = payload.databaseId?.trim();
  let matched = requestedId ? existing.find((entry) => entry.id === requestedId) : undefined;

  if (type !== 'sqlite' && !config.connectionString) {
    // A blank address keeps the one stored for the database being edited. Without an id, the
    // only database of this kind is the one meant (how a single connection was re-saved).
    const sameKind = existing.filter((entry) => entry.type === type && secrets[entry.id]);
    const reused = matched ?? (requestedId ? undefined : sameKind.length === 1 ? sameKind[0] : undefined);
    const stored = reused ? secrets[reused.id]?.connectionString : undefined;
    if (stored) {
      config.connectionString = stored;
      matched = reused;
    }
  }
  if (type !== 'sqlite' && !config.connectionString) {
    throw new Error(`${type === 'mysql' ? 'MySQL' : 'PostgreSQL'} 접속 주소를 입력해 주세요.`);
  }
  if (!requestedId && !matched) {
    // Connecting the same file or server again changes that database instead of adding a copy.
    matched = existing.find((entry) => sameDatabase(entry, config, secrets));
  }
  const databaseId = matched?.id ?? (existing.length === 0 ? DEFAULT_RDB_DATABASE_ID : randomUUID());

  const probe = await probeRdbConnection(config);
  if (!probe.ok) {
    throw new Error(rdbProbeErrorMessage(probe));
  }

  const nextSecrets: RdbDatabaseSecrets = { ...secrets };
  if (config.type === 'sqlite') {
    delete nextSecrets[databaseId];
  } else {
    nextSecrets[databaseId] = { connectionString: config.connectionString! };
  }
  await writeRdbSecrets(nextSecrets);

  // Columns and relations let the read catalog offer joined reads; without them reads still work.
  const schema = await summarizeRdbSchema(config).catch(() => undefined);

  // Re-read after the awaits above; a schema fill may have persisted meanwhile.
  const latest = store.getConnections().find((entry) => entry.connector === 'rdb');
  const others = rdbDatabaseEntries(latest?.config).filter((entry) => entry.id !== databaseId);
  const label = payload.label?.trim() || (others.length > 0 ? defaultRdbLabel(databaseId, config) : undefined);
  const entry: RdbDatabaseEntry = {
    id: databaseId,
    label,
    type: config.type,
    filePath: config.type === 'sqlite' ? config.filePath : undefined,
    allowedSchemas: config.allowedSchemas,
    allowedTables: config.allowedTables,
    rowLimit: config.rowLimit,
    connectionStringStored: config.type === 'sqlite' ? undefined : true,
    schema,
    connectedAt: new Date().toISOString(),
    lastError: undefined,
  };
  // Every field is this connect's own: a value it leaves out must not survive from before.
  const next = upsertRdbDatabase(latest?.config, entry).map((current) => current.id === databaseId ? withoutUndefined(current) : current);
  applyRdbConnector(store, runtime, next, nextSecrets);
  return {
    databaseId,
    ...(label ? { label } : {}),
    ...(probe.warning ? { warning: rdbProbeWarningMessage(probe.warning) } : {}),
  };
}
