import { deleteOsSecret, getOsSecret, setOsSecret } from '../../credential-store.js';

const RDB_SECRET_NAME = 'rdb.connection-string';

export async function getRdbConnectionString(): Promise<string | null> {
  const value = await getOsSecret(RDB_SECRET_NAME);
  return value?.trim() || null;
}

export async function saveRdbConnectionString(value: string): Promise<void> {
  await setOsSecret(RDB_SECRET_NAME, value);
}

export async function deleteRdbConnectionString(): Promise<void> {
  await deleteOsSecret(RDB_SECRET_NAME);
}
