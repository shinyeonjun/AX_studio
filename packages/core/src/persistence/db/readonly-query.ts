/** Read adapters expose curated SELECTs and table metadata, never connection controls. */
export function assertReadonlySqliteQuery(sql: string): void {
  if (/[;\0]/u.test(sql) || !/^\s*(?:SELECT\b|PRAGMA\s+(?:table_info|table_xinfo)\s*\()/iu.test(sql)) {
    throw new Error('sqlite_read_only_query_required');
  }
}
