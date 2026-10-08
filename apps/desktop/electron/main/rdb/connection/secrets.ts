import { DEFAULT_RDB_DATABASE_ID } from '@ax-studio/core';
import { deleteOsSecret, getOsSecret, setOsSecret } from '../../credential-store.js';

/** Every database's connection string, keyed by database id, in one OS secret. */
export const RDB_SECRET_NAME = 'rdb.connection-strings';
/** The single connection string saved before several databases were possible. */
export const LEGACY_RDB_SECRET_NAME = 'rdb.connection-string';

export type RdbDatabaseSecrets = Record<string, { connectionString: string }>;

function parseRdbSecrets(value: string | null): RdbDatabaseSecrets {
  if (!value) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const secrets: RdbDatabaseSecrets = {};
  for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
    const connectionString = entry && typeof entry === 'object'
      ? (entry as { connectionString?: unknown }).connectionString
      : undefined;
    if (id.trim() && typeof connectionString === 'string' && connectionString.trim()) {
      secrets[id] = { connectionString: connectionString.trim() };
    }
  }
  return secrets;
}

/**
 * The stored connection strings, and whether the pre-multi-database secret is still there.
 * That legacy string reads as the default database's until a write replaces it.
 */
export async function readRdbSecretState(): Promise<{ secrets: RdbDatabaseSecrets; legacy: boolean }> {
  const secrets = parseRdbSecrets(await getOsSecret(RDB_SECRET_NAME));
  const legacy = (await getOsSecret(LEGACY_RDB_SECRET_NAME))?.trim();
  if (legacy && !secrets[DEFAULT_RDB_DATABASE_ID]) {
    secrets[DEFAULT_RDB_DATABASE_ID] = { connectionString: legacy };
  }
  return { secrets, legacy: Boolean(legacy) };
}

export async function readRdbSecrets(): Promise<RdbDatabaseSecrets> {
  return (await readRdbSecretState()).secrets;
}

/** Writes the whole map; the legacy single secret goes once its value lives in the map. */
export async function writeRdbSecrets(secrets: RdbDatabaseSecrets): Promise<void> {
  if (Object.keys(secrets).length === 0) {
    await deleteOsSecret(RDB_SECRET_NAME);
  } else {
    await setOsSecret(RDB_SECRET_NAME, JSON.stringify(secrets));
  }
  await deleteOsSecret(LEGACY_RDB_SECRET_NAME);
}
