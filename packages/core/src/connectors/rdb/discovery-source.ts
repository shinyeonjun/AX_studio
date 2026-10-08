import { createHash } from 'node:crypto';
import { tableArtifactFromRows } from '../../contracts/artifacts/table-build.js';
import type { DiscoverySourceContext, DiscoverySourceProvider, SourceProfileResult } from '../../contracts/discovery-source.js';
import { matchRdbDatabase, parseRdbDatabases, parseRdbSourceId, rdbDatabaseName, rdbSourceId, type RdbDatabase } from './config/databases.js';
import {
  formatRdbTableRef,
  isAllowedRdbTable,
  listRdbTables,
  normalizeRdbRowLimit,
  parseRdbTableRef,
  readRdbRows,
} from './client.js';

function fingerprintTable(table: { columns: Array<{ name: string }>; rows: unknown[]; source?: { queryFingerprint?: string } }, query: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify({
    query,
    columns: table.columns.map((column) => column.name),
    rowCount: table.rows.length,
    rows: table.rows,
    queryFingerprint: table.source?.queryFingerprint,
  })).digest('hex');
}

/** The connection's databases that can be opened (credentials merged by the host). */
async function openableDatabases(ctx: DiscoverySourceContext): Promise<RdbDatabase[]> {
  const connection = ctx.store.getConnections().find((entry) => entry.connector === 'rdb' && entry.connected);
  if (!connection) return [];
  const resolvedConfig = await ctx.resolveConnectionConfig?.('rdb', connection.config);
  return parseRdbDatabases(resolvedConfig === undefined ? connection.config : resolvedConfig);
}

export const rdbDiscoverySource: DiscoverySourceProvider = {
  connector: 'rdb',

  async listSources(ctx: DiscoverySourceContext) {
    const databases = await openableDatabases(ctx);
    const several = databases.length > 1;
    const lists = await Promise.all(databases.map(async (config) => (await listRdbTables(config)).map((table) => ({
      // With several databases a table is named with its database, so two "orders" stay apart.
      id: rdbSourceId(config.id, formatRdbTableRef(table)),
      connector: 'rdb',
      label: several ? `${rdbDatabaseName(config)} · ${formatRdbTableRef(table)}` : formatRdbTableRef(table),
      kind: 'table' as const,
      relevance: 0,
      profileSummary: `${config.type} table ${formatRdbTableRef(table)}`,
    }))));
    return lists.flat();
  },

  async profileSource(ctx: DiscoverySourceContext, sourceId: string): Promise<SourceProfileResult | null> {
    if (!sourceId.startsWith('rdb:')) return null;
    if (ctx.budget.sourceReadsUsed >= ctx.budget.sourceReadsMax) return null;
    const named = parseRdbSourceId(sourceId);
    const config = named ? matchRdbDatabase(await openableDatabases(ctx), named.databaseId) : undefined;
    if (!named || !config) return null;
    const table = parseRdbTableRef(named.table);
    if (!table || !isAllowedRdbTable(config, table)) return null;
    if (ctx.budget.sourceReadsUsed >= ctx.budget.sourceReadsMax) return null;
    ctx.budget.sourceReadsUsed += 1;
    const rowLimit = normalizeRdbRowLimit(config.rowLimit, 200);
    const rows = await readRdbRows(config, table, rowLimit + 1);
    const query = { table: formatRdbTableRef(table), database: config.type, rowLimit };
    const queryFingerprint = fingerprintTable({
      columns: [...new Set(rows.flatMap((row) => Object.keys(row)))].map((name) => ({ name })),
      rows,
      source: {},
    }, query);
    const artifact = tableArtifactFromRows(rows, {
      id: `snap_${createHash('sha256').update(`${sourceId}:${JSON.stringify(query)}`).digest('hex').slice(0, 16)}`,
      name: formatRdbTableRef(table),
      rowLimit,
      source: {
        schema: table.schema,
        table: table.table,
        database: config.type,
        queryFingerprint,
        capturedAt: new Date().toISOString(),
      },
    });
    if (!artifact) return null;
    const headers = artifact.columns.map((column) => column.name);
    return {
      descriptor: {
        id: sourceId,
        connector: 'rdb',
        label: formatRdbTableRef(table),
        kind: 'table',
        relevance: 0,
        profileSummary: headers.join(', '),
      },
      table: artifact,
      fingerprint: fingerprintTable(artifact, query),
      queryJson: JSON.stringify(query),
    };
  },
};
