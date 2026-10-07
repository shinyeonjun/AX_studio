import { openReadonlySqlite } from '../../../persistence/db.js';
import { describeRdbTable } from './describe.js';
import { openRdbSqlClient } from './drivers.js';
import { isAllowedRdbTable, resolveRdbTableRef } from './policy.js';
import { MAX_RDB_OFFSET, MAX_RDB_RESULT_ROWS } from './rows.js';
import { formatRdbTableRef, parseRdbTableRef, quoteRdbIdentifier as quoteName, quoteTableRef } from './table-ref.js';
import type { RdbConnectionConfig, RdbRow, RdbTableRef } from './types.js';

/** Add the columns of `table`'s row whose `references` equals the base row's `on`. */
export interface RdbJoin {
  table: string;
  on: string;
  references: string;
}

export const MAX_RDB_JOINS = 3;

export class RdbJoinError extends Error {
  constructor(readonly reason: 'invalid_join' | 'table_not_allowed' | 'join_column_unknown' | 'join_key_not_unique') {
    super(reason);
  }
}

export function parseRdbJoins(value: unknown): RdbJoin[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_RDB_JOINS) return undefined;
  const joins: RdbJoin[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const { table, on, references, ...rest } = entry as Record<string, unknown>;
    if (Object.keys(rest).length > 0 || typeof table !== 'string' || typeof on !== 'string' || typeof references !== 'string') return undefined;
    if (!on.trim() || !references.trim() || on.length > 128 || references.length > 128) return undefined;
    joins.push({ table, on, references });
  }
  return joins;
}

/** The joined table's column, named so it cannot collide with the base table's: "customers.region". */
export function joinedColumnName(join: Pick<RdbJoin, 'table'>, column: string): string {
  return `${join.table.split('.').at(-1)}.${column}`;
}

type ResolvedJoin = RdbJoin & { ref: RdbTableRef; columns: string[] };

async function resolveJoins(config: RdbConnectionConfig, base: RdbTableRef, joins: readonly RdbJoin[], abortSignal?: AbortSignal) {
  const baseColumns = new Set((await describeRdbTable(config, base, abortSignal)).map((column) => column.name));
  const resolved: ResolvedJoin[] = [];
  for (const join of joins) {
    const parsed = parseRdbTableRef(join.table);
    if (!parsed) throw new RdbJoinError('invalid_join');
    const ref = resolveRdbTableRef(config, parsed);
    if (!isAllowedRdbTable(config, ref)) throw new RdbJoinError('table_not_allowed');
    const columns = (await describeRdbTable(config, ref, abortSignal)).map((column) => column.name);
    if (!baseColumns.has(join.on) || !columns.includes(join.references)) throw new RdbJoinError('join_column_unknown');
    resolved.push({ ...join, table: formatRdbTableRef(ref), ref, columns: columns.filter((column) => column !== join.references) });
  }
  return resolved;
}

function joinSql(config: RdbConnectionConfig, base: RdbTableRef, joins: readonly ResolvedJoin[]) {
  const quote = config.type === 'mysql' ? '`' : '"';
  const projection = ['b.*', ...joins.flatMap((join, index) => join.columns
    .map((column) => `j${index}.${quoteName(column, quote)} AS ${quoteName(joinedColumnName(join, column), quote)}`))];
  const from = [`${quoteTableRef(resolveRdbTableRef(config, base), quote)} b`, ...joins.map((join, index) =>
    `LEFT JOIN ${quoteTableRef(join.ref, quote)} j${index} ON b.${quoteName(join.on, quote)} = j${index}.${quoteName(join.references, quote)}`)];
  const uniqueness = joins.map((join) => {
    const key = quoteName(join.references, quote);
    return `SELECT COUNT(${key}) AS n, COUNT(DISTINCT ${key}) AS d FROM ${quoteTableRef(join.ref, quote)}`;
  });
  return { select: `SELECT ${projection.join(', ')} FROM ${from.join(' ')}`, uniqueness };
}

/**
 * A page of the base table with each joined table's matching row alongside, as one table.
 * Every joined key must identify at most one row, so a join can add columns but never repeat or
 * drop base rows: totals over the joined table equal totals over the base table.
 */
export async function readRdbJoinedRows(
  config: RdbConnectionConfig,
  base: RdbTableRef,
  joins: readonly RdbJoin[],
  rowLimit: number,
  abortSignal?: AbortSignal,
  options: { offset?: number } = {},
): Promise<RdbRow[]> {
  abortSignal?.throwIfAborted();
  const limit = Math.min(Math.max(1, Math.floor(rowLimit)), MAX_RDB_RESULT_ROWS + 1);
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RDB_OFFSET) throw new Error('invalid_row_pagination');
  const resolved = await resolveJoins(config, base, joins, abortSignal);
  const sql = joinSql(config, base, resolved);

  if (config.type === 'sqlite' && config.filePath) {
    const db = await openReadonlySqlite(config.filePath);
    try {
      for (const check of sql.uniqueness) {
        const [counts] = db.all(check);
        if (Number(counts?.n) !== Number(counts?.d)) throw new RdbJoinError('join_key_not_unique');
      }
      abortSignal?.throwIfAborted();
      return db.all(`${sql.select} LIMIT ${limit} OFFSET ${offset}`) as RdbRow[];
    } finally {
      db.close();
    }
  }
  const client = await openRdbSqlClient(config, abortSignal);
  try {
    for (const check of sql.uniqueness) {
      const [counts] = await client.query(check);
      if (Number(counts?.n) !== Number(counts?.d)) throw new RdbJoinError('join_key_not_unique');
    }
    return await client.query(config.type === 'mysql' ? `${sql.select} LIMIT ? OFFSET ?` : `${sql.select} LIMIT $1 OFFSET $2`, [limit, offset]);
  } finally {
    await client.close();
  }
}
