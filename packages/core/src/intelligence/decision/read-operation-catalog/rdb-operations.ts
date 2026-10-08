import type { SourceListingConnection } from '../../../connectors/types.js';
import { addIndexedOperation, type IndexedReadOperation } from './indexed-operation.js';
import { asRecord, limitParameterHint, text } from './request-values.js';
import { DEFAULT_RDB_DATABASE_ID, rdbDatabaseEntries, rdbDatabaseName, type RdbDatabaseEntry } from '../../../connectors/rdb/config/databases.js';

/** Columns named in an operation's description; enough for Jev to see where a field lives. */
const DESCRIBED_COLUMNS = 30;
/** Joins offered from one table at once (each its own operation, then all together). */
const MAX_JOINS = 3;

interface TableShape {
  table: string;
  columns: string[];
}

interface Relation {
  from: { table: string; column: string };
  to: { table: string; column: string };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())) : [];
}

/** The schema summary saved with the connection; anything malformed is ignored, never guessed. */
function savedSchema(config: { schema?: unknown }, allowed: ReadonlySet<string>): { tables: Map<string, TableShape>; relations: Relation[] } {
  const schema = asRecord(config.schema);
  const tables = new Map<string, TableShape>();
  for (const entry of Array.isArray(schema?.tables) ? schema.tables : []) {
    const record = asRecord(entry);
    if (typeof record?.table !== 'string' || !allowed.has(record.table)) continue;
    tables.set(record.table, { table: record.table, columns: stringList(record.columns) });
  }
  const relations: Relation[] = [];
  for (const entry of Array.isArray(schema?.relations) ? schema.relations : []) {
    const record = asRecord(entry);
    const from = asRecord(record?.from);
    const to = asRecord(record?.to);
    if (typeof from?.table !== 'string' || typeof from.column !== 'string' || typeof to?.table !== 'string' || typeof to.column !== 'string') continue;
    if (!tables.has(from.table) || !tables.has(to.table)) continue;
    relations.push({ from: { table: from.table, column: from.column }, to: { table: to.table, column: to.column } });
  }
  return { tables, relations };
}

function columnList(columns: readonly string[]): string {
  const shown = columns.slice(0, DESCRIBED_COLUMNS).join(', ');
  return columns.length > DESCRIBED_COLUMNS ? `${shown} 외 ${columns.length - DESCRIBED_COLUMNS}개` : shown;
}

export function addRdbOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  const databases = rdbDatabaseEntries(connection.config);
  for (const database of databases) addDatabaseOperations(operations, database, databases.length > 1);
}

/**
 * One database's reads. With several databases each read names its database (connectionId,
 * so authorization and recurring jobs read the same one) and says which in its description,
 * since Jev sees labels and descriptions, not connections.
 */
function addDatabaseOperations(operations: IndexedReadOperation[], database: RdbDatabaseEntry, several: boolean): void {
  const connectionLabel = text(database.label, 100) ?? (several ? rdbDatabaseName(database) : undefined);
  const tables = database.allowedTables ?? [];
  const schema = savedSchema(database, new Set(tables));
  const source = connectionLabel ? { sourceLabel: connectionLabel } : {};
  const pinned = several || database.id !== DEFAULT_RDB_DATABASE_ID ? { connectionId: database.id } : {};
  const inDatabase = several && connectionLabel ? `${connectionLabel}의 ` : '';
  if (tables.length > 0) {
    addIndexedOperation(operations, {
      capabilityId: 'rdb.schema.describe',
      connector: 'rdb',
      ...source,
      label: connectionLabel ? `${connectionLabel} 스키마` : 'DB 스키마',
      description: connectionLabel
        ? `${connectionLabel}의 허용된 테이블 목록 및 DB 스키마 구조 조회 (테이블 구조 확인 전용)`
        : '허용된 DB 테이블 목록 및 스키마 구조 조회 (테이블 구조 확인 전용)',
    }, () => ({ params: { ...pinned } }));
  }
  const readHints = (userMessage: string) => [limitParameterHint('limit', userMessage, 'Maximum number of rows to return.')];
  for (const table of tables) {
    const safeTable = table.slice(0, 160);
    const columns = schema.tables.get(table)?.columns ?? [];
    addIndexedOperation(operations, {
      capabilityId: 'rdb.query.read',
      connector: 'rdb',
      ...source,
      label: `DB 조회: ${safeTable}`,
      description: columns.length > 0 ? `${inDatabase}허용된 테이블 ${safeTable} 읽기 · 열: ${columnList(columns)}` : `${inDatabase}허용된 테이블 ${safeTable} 읽기`,
    }, (userMessage) => ({ params: { ...pinned, table }, parameterHints: readHints(userMessage) }));

    // A question about orders by customer region needs each order with its customer's columns.
    const outgoing = schema.relations.filter((relation) => relation.from.table === table).slice(0, MAX_JOINS);
    const groups = outgoing.length > 1 ? [...outgoing.map((relation) => [relation]), outgoing] : outgoing.map((relation) => [relation]);
    for (const group of groups) {
      const joined = group.map((relation) => relation.to.table);
      addIndexedOperation(operations, {
        capabilityId: 'rdb.query.read',
        connector: 'rdb',
        ...source,
        label: `DB 조회: ${[safeTable, ...joined].join(' + ')}`,
        description: `${inDatabase}${safeTable}의 각 행에 ${group.map((relation) => {
          const added = (schema.tables.get(relation.to.table)?.columns ?? []).filter((column) => column !== relation.to.column);
          return `${relation.to.table}의 열(${columnList(added)})을 ${relation.from.column} = ${relation.to.table}.${relation.to.column}로`;
        }).join(', ')} 붙여 함께 읽기. 붙인 열 이름은 "${joined[0]}.열" 형식`,
      }, (userMessage) => ({
        params: { ...pinned, table, join: group.map((relation) => ({ table: relation.to.table, on: relation.from.column, references: relation.to.column })) },
        parameterHints: readHints(userMessage),
      }));
    }
  }
}
