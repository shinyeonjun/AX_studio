import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { parseRdbConnectionConfig } from '../../modules/rdb/index.js';
import { openReadonlySqlite } from '../../store/db.js';
import { buildTableArtifact } from '../../modules/local-sheet/profile.js';
import type { SourceDescriptor } from '../schema.js';
import type { DiscoverySourceContext, DiscoverySourceProvider, SourceProfileResult } from './types.js';

function fingerprintTable(table: { columns: Array<{ name: string }>; rows: unknown[]; source?: { queryFingerprint?: string } }, query: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify({
    query,
    columns: table.columns.map((column) => column.name),
    rowCount: table.rows.length,
    queryFingerprint: table.source?.queryFingerprint,
  })).digest('hex');
}

export class RdbDiscoverySourceProvider implements DiscoverySourceProvider {
  readonly connector = 'rdb';

  async listSources(ctx: DiscoverySourceContext): Promise<SourceDescriptor[]> {
    const connection = ctx.store.getConnections().find((entry) => entry.connector === 'rdb' && entry.connected);
    if (!connection) return [];
    const config = parseRdbConnectionConfig(connection.config);
    if (!config || config.type !== 'sqlite' || !config.filePath) return [];
    const db = await openReadonlySqlite(config.filePath);
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
    db.close();
    return tables
      .map((row) => String(row.name))
      .filter((name) => !config.allowedTables?.length || config.allowedTables.includes(name))
      .map((name) => ({
        id: `rdb:${name}`,
        connector: 'rdb',
        label: name,
        kind: 'table' as const,
        relevance: 0,
        profileSummary: `sqlite table ${name}`,
      }));
  }

  async profileSource(ctx: DiscoverySourceContext, sourceId: string): Promise<SourceProfileResult | null> {
    if (ctx.budget.sourceReadsUsed >= ctx.budget.sourceReadsMax) return null;
    const connection = ctx.store.getConnections().find((entry) => entry.connector === 'rdb' && entry.connected);
    if (!connection) return null;
    const config = parseRdbConnectionConfig(connection.config);
    if (!config || config.type !== 'sqlite' || !config.filePath) return null;
    const table = sourceId.replace(/^rdb:/, '');
    if (config.allowedTables?.length && !config.allowedTables.includes(table)) return null;
    const rowLimit = config.rowLimit ?? 200;
    const db = await openReadonlySqlite(config.filePath);
    const rows = db.all(`SELECT * FROM ${table} LIMIT ${rowLimit + 1}`);
    db.close();
    const truncated = rows.length > rowLimit;
    const limited = truncated ? rows.slice(0, rowLimit) : rows;
    const headers = limited.length > 0 ? Object.keys(limited[0]!) : [];
    const matrix = limited.map((row) => headers.map((header) => (row as Record<string, unknown>)[header]));
    const query = { table, database: config.filePath, rowLimit };
    const artifact = buildTableArtifact({
      id: `snap_${createHash('sha256').update(`${sourceId}:${JSON.stringify(query)}`).digest('hex').slice(0, 16)}`,
      name: table,
      headers,
      matrix,
      rowLimit,
      source: { table, database: config.filePath, queryFingerprint: fingerprintTable({ columns: headers.map((name) => ({ name })), rows: limited, source: {} }, query) },
    });
    ctx.budget.sourceReadsUsed += 1;
    return {
      descriptor: {
        id: sourceId,
        connector: 'rdb',
        label: table,
        kind: 'table',
        relevance: 0,
        profileSummary: headers.join(', '),
      },
      table: artifact,
      fingerprint: fingerprintTable(artifact, query),
      queryJson: JSON.stringify(query),
    };
  }
}
