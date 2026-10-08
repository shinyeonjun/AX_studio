import {
  describeTables,
  rdbDatabaseEntries,
  rdbDatabaseName,
  serializeRdbDatabases,
  upsertRdbDatabase,
  type AgentHarness,
  type RdbDatabaseEntry,
  type WorkflowStore,
} from '@ax-studio/core';
import { withRdbConnectionLock } from './lock.js';

function tableShapes(entry: RdbDatabaseEntry): Array<{ table: string; columns: string[] }> {
  const allowed = new Set(entry.allowedTables ?? []);
  const tables = (entry.schema as { tables?: unknown } | undefined)?.tables;
  if (!Array.isArray(tables)) return [];
  return tables.flatMap((value) => {
    const shape = value as { table?: unknown; columns?: unknown };
    if (typeof shape.table !== 'string' || !allowed.has(shape.table)) return [];
    const columns = Array.isArray(shape.columns) ? shape.columns.filter((column): column is string => typeof column === 'string') : [];
    return [{ table: shape.table, columns }];
  });
}

/**
 * Gives each connected database's tables a short Korean description, asked once of the person's
 * AI from table and column names (see describeTables), so Jev can match "주문" to tb_ord_mst.
 * Runs in the background after connecting and at startup; without an AI it changes nothing.
 */
export async function fillRdbTableDescriptions(store: WorkflowStore, harness: Pick<AgentHarness, 'runText'>): Promise<void> {
  const row = store.getConnections().find((entry) => entry.connector === 'rdb');
  if (!row?.connected) return;
  for (const entry of rdbDatabaseEntries(row.config)) {
    const shapes = tableShapes(entry);
    if (shapes.every((shape) => entry.tableDescriptions?.[shape.table])) continue;
    const learned = await describeTables({ harness, database: rdbDatabaseName(entry), tables: shapes, known: entry.tableDescriptions });
    if (Object.keys(learned).length === Object.keys(entry.tableDescriptions ?? {}).length) continue;
    await withRdbConnectionLock(async () => {
      const current = store.getConnections().find((candidate) => candidate.connector === 'rdb');
      if (!current?.connected) return;
      const saved = rdbDatabaseEntries(current.config).find((candidate) => candidate.id === entry.id);
      if (!saved) return;
      const tableDescriptions = { ...learned, ...saved.tableDescriptions };
      store.setConnection('rdb', true, serializeRdbDatabases(upsertRdbDatabase(current.config, { ...saved, tableDescriptions })));
    });
  }
}
