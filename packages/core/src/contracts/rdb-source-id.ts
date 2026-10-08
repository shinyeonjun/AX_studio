/** The id the 'rdb' connection's first (and, before several were possible, only) database has. */
export const DEFAULT_RDB_DATABASE_ID = 'default';

/**
 * A database table as a work-discovery source id: "rdb:orders" for the default database (the
 * id format before several databases), "rdb:<databaseId>/orders" for any other.
 */
export function rdbSourceId(databaseId: string, table: string): string {
  return databaseId === DEFAULT_RDB_DATABASE_ID ? `rdb:${table}` : `rdb:${databaseId}/${table}`;
}

export function parseRdbSourceId(sourceId: string): { databaseId: string; table: string } | undefined {
  if (!sourceId.startsWith('rdb:')) return undefined;
  const rest = sourceId.slice(4);
  const slash = rest.indexOf('/');
  return slash > 0
    ? { databaseId: rest.slice(0, slash), table: rest.slice(slash + 1) }
    : { databaseId: DEFAULT_RDB_DATABASE_ID, table: rest };
}
