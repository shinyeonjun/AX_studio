import { openReadonlySqlite } from '../../../persistence/db.js';
import type { RdbConnectionConfig } from '../connector.js';
import { openRdbSqlClient } from './drivers.js';
import { isAllowedRdbTable, resolveRdbTableRef } from './policy.js';
import { quoteTableRef } from './table-ref.js';
import type { RdbTableRef } from './types.js';

export function parseRdbMetadataPage(offset: unknown = 0, limit: unknown = 100): { offset: number; limit: number } | null {
  return typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0 && offset <= 1_000_000
    && typeof limit === 'number' && Number.isSafeInteger(limit) && limit >= 1 && limit <= 200
    ? { offset, limit } : null;
}

export async function describeRdbTablePage(config: RdbConnectionConfig, ref: RdbTableRef,
  page: { offset?: number; limit?: number } = {}, abortSignal?: AbortSignal) {
  const normalized = parseRdbMetadataPage(page.offset, page.limit);
  if (!normalized) throw new Error('invalid_metadata_pagination');
  const rows = await readColumns(config, ref, normalized, abortSignal);
  const { offset, limit } = normalized;
  const hasMore = rows.length > limit;
  const columns = rows.slice(0, limit);
  const partial = offset > 0 || hasMore;
  return { columns, offset, limit, hasMore, ...(hasMore ? { nextOffset: offset + columns.length } : {}),
    truncated: partial,
    completeness: { status: partial ? 'partial' as const : 'complete' as const,
      ...(partial ? { reason: 'provider_limit' as const } : {}), observedCount: columns.length, hasMore },
  };
}

/** Legacy callers require a whole bounded dictionary, never a silent first page. */
export async function describeRdbTable(config: RdbConnectionConfig, ref: RdbTableRef, abortSignal?: AbortSignal) {
  const page = await describeRdbTablePage(config, ref, { limit: 200 }, abortSignal);
  if (page.hasMore) throw new Error('rdb_metadata_limit');
  return page.columns;
}

/** Physical column metadata only: no row values or inferred business keys. */
async function readColumns(config: RdbConnectionConfig, ref: RdbTableRef,
  page: { offset: number; limit: number }, abortSignal?: AbortSignal) {
  abortSignal?.throwIfAborted();
  const resolved = resolveRdbTableRef(config, ref);
  if (!isAllowedRdbTable(config, resolved)) throw new Error('table_not_allowed');
  if (config.type === 'sqlite' && config.filePath) {
    if (resolved.schema) throw new Error('invalid_table_name');
    const db = await openReadonlySqlite(config.filePath);
    try {
      abortSignal?.throwIfAborted();
      const rows = db.all(`PRAGMA table_xinfo(${quoteTableRef(resolved, '"')})`)
        .filter(row => Number(row.hidden) !== 1)
        .slice(page.offset, page.offset + page.limit + 1);
      return rows.map(row => ({ name: String(row.name), type: String(row.type),
        // SQLite permits NULL for some non-INTEGER primary key declarations.
        notNullDeclared: Number(row.notnull) !== 0, primaryKeyPosition: Number(row.pk),
        ...(boundedDescription(row.description) ? { description: boundedDescription(row.description) } : {}) }));
    } finally { db.close(); }
  }
  const client = await openRdbSqlClient(config, abortSignal);
  try {
    const rows = config.type === 'postgres'
      ? await client.query(`SELECT c.column_name, c.data_type, c.is_nullable,
          pg_catalog.col_description(cl.oid, c.ordinal_position) AS description
          FROM information_schema.columns AS c
          LEFT JOIN pg_catalog.pg_namespace AS ns ON ns.nspname = c.table_schema
          LEFT JOIN pg_catalog.pg_class AS cl ON cl.relnamespace = ns.oid AND cl.relname = c.table_name
          WHERE c.table_schema = COALESCE($1, current_schema()) AND c.table_name = $2
          ORDER BY c.ordinal_position LIMIT ${page.limit + 1} OFFSET ${page.offset}`, [resolved.schema ?? null, resolved.table])
      : await client.query(`SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable,
          COLUMN_COMMENT AS description
          FROM information_schema.columns WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
          ORDER BY ORDINAL_POSITION LIMIT ${page.limit + 1} OFFSET ${page.offset}`, [resolved.schema ?? null, resolved.table]);
    return rows.map(row => ({ name: String(row.column_name), type: String(row.data_type),
      nullable: row.is_nullable === 'YES',
      ...(boundedDescription(row.description) ? { description: boundedDescription(row.description) } : {}) }));
  } finally { await client.close(); }
}

const MAX_DESCRIPTION_LENGTH = 500;

function boundedDescription(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_DESCRIPTION_LENGTH) : undefined;
}
