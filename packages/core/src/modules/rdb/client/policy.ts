import type { RdbConnectionConfig } from '../connector.js';
import { formatRdbTableRef } from './table-ref.js';
import type { RdbTableInfo, RdbTableRef } from './types.js';

function isAllowedSchema(config: RdbConnectionConfig, ref: RdbTableRef): boolean {
  if (config.type === 'sqlite') return !ref.schema;
  const allowed = config.allowedSchemas ?? [];
  if (allowed.length === 0) return true;
  return ref.schema ? allowed.includes(ref.schema) : false;
}

export function isAllowedRdbTable(config: RdbConnectionConfig, ref: RdbTableRef): boolean {
  if (!isAllowedSchema(config, ref)) return false;
  const allowed = config.allowedTables ?? [];
  if (allowed.length === 0) return false;
  const formatted = formatRdbTableRef(ref);
  return allowed.some((entry) => {
    const normalized = entry.trim();
    return normalized === formatted || normalized === ref.table;
  });
}

export function filterRdbTables(config: RdbConnectionConfig, tables: RdbTableInfo[]): RdbTableInfo[] {
  return tables.filter((table) => {
    if (!isAllowedSchema(config, table)) return false;
    if (!config.allowedTables?.length) return true;
    return isAllowedRdbTable(config, table);
  });
}
