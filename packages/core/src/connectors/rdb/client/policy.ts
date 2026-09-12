import { formatRdbTableRef } from './table-ref.js';
import type { RdbConnectionConfig, RdbTableInfo, RdbTableRef } from './types.js';

/**
 * Resolve an unqualified table against the only explicitly allowed schema.
 *
 * Natural-language requests usually name a table as `customers`, while the
 * database metadata and SQL policy use `public.customers`. Resolving only
 * when there is exactly one allowed schema keeps multi-schema connections
 * fail-closed and makes the schema part of the SQL identifier before any
 * query is issued.
 */
export function resolveRdbTableRef(config: RdbConnectionConfig, ref: RdbTableRef): RdbTableRef {
  if (config.type === 'sqlite' || ref.schema) return ref;
  const allowedSchemas = (config.allowedSchemas ?? [])
    .map((schema) => schema.trim())
    .filter(Boolean);
  return allowedSchemas.length === 1
    ? { schema: allowedSchemas[0], table: ref.table }
    : ref;
}

function isAllowedSchema(config: RdbConnectionConfig, ref: RdbTableRef): boolean {
  if (config.type === 'sqlite') return !ref.schema;
  const allowed = config.allowedSchemas ?? [];
  if (allowed.length === 0) return true;
  return ref.schema ? allowed.includes(ref.schema) : false;
}

export function isAllowedRdbTable(config: RdbConnectionConfig, ref: RdbTableRef): boolean {
  const resolved = resolveRdbTableRef(config, ref);
  if (!isAllowedSchema(config, resolved)) return false;
  const allowed = config.allowedTables ?? [];
  if (allowed.length === 0) return false;
  const formatted = formatRdbTableRef(resolved);
  return allowed.some((entry) => {
    const normalized = entry.trim();
    return normalized === formatted || normalized === resolved.table;
  });
}

export function filterRdbTables(config: RdbConnectionConfig, tables: RdbTableInfo[]): RdbTableInfo[] {
  return tables.filter((table) => {
    if (!isAllowedSchema(config, table)) return false;
    if (!config.allowedTables?.length) return true;
    return isAllowedRdbTable(config, table);
  });
}
