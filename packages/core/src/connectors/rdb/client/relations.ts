import { openReadonlySqlite } from '../../../persistence/db.js';
import { openRdbSqlClient } from './drivers.js';
import { listRdbTables } from './catalog.js';
import { formatRdbTableRef, quoteRdbIdentifier, quoteTableRef } from './table-ref.js';
import type { RdbConnectionConfig, RdbTableInfo } from './types.js';

/** One allowed table as the catalog describes it: its columns and the columns that identify a row. */
export interface RdbTableShape {
  table: string;
  columns: string[];
  /** Single columns whose values are unique (primary key or unique index). */
  uniqueColumns: string[];
}

/** `from.column` holds values of `to.column`, which identifies one row of `to.table`. */
export interface RdbRelation {
  from: { table: string; column: string };
  to: { table: string; column: string };
  /** Declared as a foreign key; otherwise inferred from names and confirmed against the data. */
  declared: boolean;
}

export interface RdbSchemaSummary {
  tables: RdbTableShape[];
  relations: RdbRelation[];
}

const MAX_SUMMARY_TABLES = 60;
const MAX_SUMMARY_COLUMNS = 80;
/** Distinct values sampled when an undeclared relation is checked against the data. */
const RELATION_SAMPLE = 200;
/** Sampled values that may be missing from the referenced column (deleted rows, typos): a tenth, at least one. */
const RELATION_MISS_RATIO = 0.1;

type Query = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

async function withReader<T>(config: RdbConnectionConfig, abortSignal: AbortSignal | undefined, run: (query: Query) => Promise<T>): Promise<T> {
  if (config.type === 'sqlite' && config.filePath) {
    const db = await openReadonlySqlite(config.filePath);
    try {
      return await run(async (sql, params) => {
        abortSignal?.throwIfAborted();
        return db.all(sql, params);
      });
    } finally {
      db.close();
    }
  }
  const client = await openRdbSqlClient(config, abortSignal);
  try {
    return await run((sql, params) => client.query(sql, params as never));
  } finally {
    await client.close();
  }
}

function placeholder(config: RdbConnectionConfig, index: number): string {
  return config.type === 'postgres' ? `$${index}` : '?';
}

async function tableShape(config: RdbConnectionConfig, query: Query, ref: RdbTableInfo): Promise<RdbTableShape> {
  const table = formatRdbTableRef(ref);
  if (config.type === 'sqlite') {
    const columns = await query('SELECT name, pk FROM pragma_table_info(?)', [ref.table]);
    const primary = columns.filter((column) => Number(column.pk) > 0);
    const unique = new Set(primary.length === 1 ? [String(primary[0]!.name)] : []);
    for (const index of await query('SELECT name, "unique" AS is_unique FROM pragma_index_list(?)', [ref.table])) {
      if (Number(index.is_unique) !== 1) continue;
      const parts = await query('SELECT name FROM pragma_index_info(?)', [String(index.name)]);
      if (parts.length === 1 && parts[0]!.name) unique.add(String(parts[0]!.name));
    }
    return { table, columns: columns.map((column) => String(column.name)).slice(0, MAX_SUMMARY_COLUMNS), uniqueColumns: [...unique] };
  }
  const schemaArg = ref.schema ?? null;
  const columns = await query(
    `SELECT column_name AS name FROM information_schema.columns
     WHERE table_schema = COALESCE(${placeholder(config, 1)}, ${config.type === 'postgres' ? 'current_schema()' : 'DATABASE()'})
       AND table_name = ${placeholder(config, 2)} ORDER BY ordinal_position`, [schemaArg, ref.table]);
  const keys = await query(
    `SELECT kcu.constraint_name AS constraint_name, kcu.column_name AS column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema AND kcu.table_name = tc.table_name
     WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
       AND tc.table_schema = COALESCE(${placeholder(config, 1)}, ${config.type === 'postgres' ? 'current_schema()' : 'DATABASE()'})
       AND tc.table_name = ${placeholder(config, 2)}`, [schemaArg, ref.table]);
  const byConstraint = new Map<string, string[]>();
  for (const key of keys) {
    const name = String(key.constraint_name);
    byConstraint.set(name, [...(byConstraint.get(name) ?? []), String(key.column_name)]);
  }
  return {
    table,
    columns: columns.map((column) => String(column.name)).slice(0, MAX_SUMMARY_COLUMNS),
    uniqueColumns: [...new Set([...byConstraint.values()].filter((parts) => parts.length === 1).map((parts) => parts[0]!))],
  };
}

async function declaredRelations(config: RdbConnectionConfig, query: Query, ref: RdbTableInfo): Promise<RdbRelation[]> {
  const table = formatRdbTableRef(ref);
  if (config.type === 'sqlite') {
    const keys = await query('SELECT id, "table" AS ref_table, "from" AS from_column, "to" AS to_column FROM pragma_foreign_key_list(?)', [ref.table]);
    const counts = new Map<unknown, number>();
    for (const key of keys) counts.set(key.id, (counts.get(key.id) ?? 0) + 1);
    return keys.filter((key) => counts.get(key.id) === 1 && key.to_column).map((key) => ({
      from: { table, column: String(key.from_column) },
      to: { table: String(key.ref_table), column: String(key.to_column) },
      declared: true,
    }));
  }
  const keys = config.type === 'postgres'
    ? await query(`SELECT tc.constraint_name AS constraint_name, kcu.column_name AS from_column,
        ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS to_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = COALESCE($1, current_schema()) AND tc.table_name = $2`,
    [ref.schema ?? null, ref.table])
    : await query(`SELECT constraint_name AS constraint_name, column_name AS from_column,
        referenced_table_schema AS ref_schema, referenced_table_name AS ref_table, referenced_column_name AS to_column
      FROM information_schema.key_column_usage
      WHERE referenced_table_name IS NOT NULL AND table_schema = COALESCE(?, DATABASE()) AND table_name = ?`,
    [ref.schema ?? null, ref.table]);
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(String(key.constraint_name), (counts.get(String(key.constraint_name)) ?? 0) + 1);
  return keys.filter((key) => counts.get(String(key.constraint_name)) === 1).map((key) => ({
    from: { table, column: String(key.from_column) },
    to: { table: formatRdbTableRef({ schema: ref.schema ? String(key.ref_schema) : undefined, table: String(key.ref_table) }), column: String(key.to_column) },
    declared: true,
  }));
}

function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

/**
 * A column that names another table and that table's key: `customer_id` or `customerId` for
 * `customers.id`, `product_code` for `products.code`, or the same distinctive name on both sides.
 */
function namesReference(column: string, target: RdbTableShape, key: string): boolean {
  const columnKey = nameKey(column);
  const keyKey = nameKey(key);
  const tableKey = nameKey(target.table.split('.').at(-1)!);
  if (columnKey === keyKey) return keyKey !== 'id' && keyKey.length > 2;
  if (!columnKey.endsWith(keyKey)) return false;
  const prefix = columnKey.slice(0, -keyKey.length);
  return prefix.length >= 2 && tableKey.startsWith(prefix);
}

async function valuesFound(config: RdbConnectionConfig, query: Query, from: RdbRelation['from'], to: RdbRelation['to']): Promise<boolean> {
  const quote = config.type === 'mysql' ? '`' : '"';
  const fromTable = quoteTableRef(splitRef(from.table), quote);
  const toTable = quoteTableRef(splitRef(to.table), quote);
  const fromColumn = quoteRdbIdentifier(from.column, quote);
  const toColumn = quoteRdbIdentifier(to.column, quote);
  const rows = await query(
    `SELECT COUNT(*) AS sampled, SUM(CASE WHEN EXISTS (SELECT 1 FROM ${toTable} r WHERE r.${toColumn} = s.v) THEN 1 ELSE 0 END) AS found
     FROM (SELECT DISTINCT ${fromColumn} AS v FROM ${fromTable} WHERE ${fromColumn} IS NOT NULL LIMIT ${RELATION_SAMPLE}) s`);
  const sampled = Number(rows[0]?.sampled ?? 0);
  const found = Number(rows[0]?.found ?? 0);
  return found > 0 && sampled - found <= Math.max(1, Math.floor(sampled * RELATION_MISS_RATIO));
}

function splitRef(table: string): RdbTableInfo {
  const parts = table.split('.');
  return parts.length === 2 ? { schema: parts[0], table: parts[1]! } : { table };
}

/**
 * The allowed tables' columns, keys and the relations between them, read once when a database is
 * connected so the read catalog can offer "orders with each customer's columns" without guessing.
 * Undeclared relations count only when nearly every sampled value exists in the referenced key.
 */
export async function summarizeRdbSchema(config: RdbConnectionConfig, abortSignal?: AbortSignal): Promise<RdbSchemaSummary> {
  const refs = (await listRdbTables(config, abortSignal)).slice(0, MAX_SUMMARY_TABLES);
  return withReader(config, abortSignal, async (query) => {
    const tables: RdbTableShape[] = [];
    for (const ref of refs) tables.push(await tableShape(config, query, ref));
    const byName = new Map(tables.map((table) => [table.table, table]));
    const relations: RdbRelation[] = [];
    const seen = new Set<string>();
    const add = (relation: RdbRelation) => {
      const id = `${relation.from.table}.${relation.from.column}`;
      if (seen.has(id)) return;
      seen.add(id);
      relations.push(relation);
    };
    for (const ref of refs) {
      for (const relation of await declaredRelations(config, query, ref)) {
        const target = byName.get(relation.to.table);
        // Only relations between allowed tables onto a unique column: anything else could repeat rows.
        if (target?.uniqueColumns.includes(relation.to.column)) add(relation);
      }
    }
    for (const source of tables) {
      for (const column of source.columns) {
        if (seen.has(`${source.table}.${column}`) || source.uniqueColumns.includes(column)) continue;
        const matches = tables.flatMap((target) => target === source ? [] : target.uniqueColumns
          .filter((key) => namesReference(column, target, key))
          .map((key) => ({ target, key })));
        if (matches.length !== 1) continue;
        const { target, key } = matches[0]!;
        const relation = { from: { table: source.table, column }, to: { table: target.table, column: key }, declared: false };
        // A failed check (an unusual column type, a timeout) leaves the relation out, never in.
        if (await valuesFound(config, query, relation.from, relation.to).catch(() => false)) add(relation);
      }
    }
    return { tables, relations };
  });
}
