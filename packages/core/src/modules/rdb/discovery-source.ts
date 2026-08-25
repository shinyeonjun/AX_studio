import { createHash } from 'node:crypto';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import type { DiscoverySourceContext, DiscoverySourceProvider, SourceProfileResult } from '../../contracts/discovery-source.js';
import { parseRdbConnectionConfig } from './index.js';
import {
  formatRdbTableRef,
  isAllowedRdbTable,
  listRdbTables,
  parseRdbTableRef,
  readRdbRows,
} from './client.js';

function fingerprintTable(table: { columns: Array<{ name: string }>; rows: unknown[]; source?: { queryFingerprint?: string } }, query: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify({
    query,
    columns: table.columns.map((column) => column.name),
    rowCount: table.rows.length,
    queryFingerprint: table.source?.queryFingerprint,
  })).digest('hex');
}

export const rdbDiscoverySource: DiscoverySourceProvider = {
  connector: 'rdb',

  async listSources(ctx: DiscoverySourceContext) {
    const connection = ctx.store.getConnections().find((entry) => entry.connector === 'rdb' && entry.connected);
    if (!connection) return [];
    const resolvedConfig = await ctx.resolveConnectionConfig?.('rdb', connection.config);
    const config = parseRdbConnectionConfig(resolvedConfig === undefined ? connection.config : resolvedConfig);
    if (!config) return [];
    const tables = await listRdbTables(config);
    return tables.map((table) => ({
        id: `rdb:${formatRdbTableRef(table)}`,
        connector: 'rdb',
        label: formatRdbTableRef(table),
        kind: 'table' as const,
        relevance: 0,
        profileSummary: `${config.type} table ${formatRdbTableRef(table)}`,
      }));
  },

  async profileSource(ctx: DiscoverySourceContext, sourceId: string): Promise<SourceProfileResult | null> {
    if (ctx.budget.sourceReadsUsed >= ctx.budget.sourceReadsMax) return null;
    const connection = ctx.store.getConnections().find((entry) => entry.connector === 'rdb' && entry.connected);
    if (!connection) return null;
    const resolvedConfig = await ctx.resolveConnectionConfig?.('rdb', connection.config);
    const config = parseRdbConnectionConfig(resolvedConfig === undefined ? connection.config : resolvedConfig);
    if (!config) return null;
    const table = parseRdbTableRef(sourceId.replace(/^rdb:/, ''));
    if (!table || !isAllowedRdbTable(config, table)) return null;
    const rowLimit = config.rowLimit ?? 200;
    const rows = await readRdbRows(config, table, rowLimit + 1);
    const truncated = rows.length > rowLimit;
    const limited = truncated ? rows.slice(0, rowLimit) : rows;
    const headers = limited.length > 0 ? Object.keys(limited[0]!) : [];
    const matrix = limited.map((row) => headers.map((header) => (row as Record<string, unknown>)[header]));
    const query = { table: formatRdbTableRef(table), database: config.type, rowLimit };
    const artifact = buildTableArtifact({
      id: `snap_${createHash('sha256').update(`${sourceId}:${JSON.stringify(query)}`).digest('hex').slice(0, 16)}`,
      name: formatRdbTableRef(table),
      headers,
      matrix,
      rowLimit,
      source: {
        schema: table.schema,
        table: table.table,
        database: config.type,
        queryFingerprint: fingerprintTable({ columns: headers.map((name) => ({ name })), rows: limited, source: {} }, query),
      },
    });
    ctx.budget.sourceReadsUsed += 1;
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
