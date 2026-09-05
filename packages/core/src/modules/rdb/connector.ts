import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { tableArtifactFromRows } from '../../contracts/artifacts/table-build.js';
import {
  formatRdbTableRef,
  isAllowedRdbTable,
  listRdbTables,
  normalizeRdbRowLimit,
  parseRdbTableRef,
  readRdbRows,
} from './client.js';

export interface RdbConnectionConfig {
  type: 'mysql' | 'postgres' | 'sqlite';
  connectionString?: string;
  filePath?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
}

export class RdbConnector implements Connector {
  name = 'rdb';

  constructor(private config: RdbConnectionConfig) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const rowLimit = normalizeRdbRowLimit(this.config.rowLimit, 1000);

    if (action === 'schema.describe') {
      try {
        const tables = await listRdbTables(this.config);
        return { ok: true, data: tables.map(formatRdbTableRef) };
      } catch (error) {
        ctx.log({
          at: new Date().toISOString(),
          level: 'error',
          message: 'rdb.schema_failed',
          data: { error: error instanceof Error ? error.message : String(error) },
        });
        return { ok: false, error: 'rdb_schema_failed', errorCode: 'rdb_error' };
      }
    }

    if (action === 'query.read' || action === 'query') {
      const ref = parseRdbTableRef(params.table);
      if (!ref) {
        return { ok: false, error: 'invalid_table_name', errorCode: 'policy_denied' };
      }
      if (!isAllowedRdbTable(this.config, ref)) {
        return { ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' };
      }

      try {
        const rows = await readRdbRows(this.config, ref, rowLimit + 1);
        const table = tableArtifactFromRows(rows, {
          id: `rdb_${ctx.executionId}_${formatRdbTableRef(ref).replace(/[^A-Za-z0-9_]+/g, '_')}`,
          name: formatRdbTableRef(ref),
          rowLimit,
          source: {
            database: this.config.type,
            schema: ref.schema,
            table: ref.table,
            capturedAt: new Date().toISOString(),
          },
        });
        if (!table) return { ok: false, error: 'rdb_rows_invalid', errorCode: 'rdb_error' };
        ctx.variables.queryResult = table;
        return { ok: true, data: table };
      } catch (error) {
        ctx.log({
          at: new Date().toISOString(),
          level: 'error',
          message: 'rdb.query_failed',
          data: { table: formatRdbTableRef(ref), error: error instanceof Error ? error.message : String(error) },
        });
        return { ok: false, error: 'rdb_query_failed', errorCode: 'rdb_error' };
      }
    }

    return { ok: false, error: `Unknown or denied rdb action: ${action}` };
  }
}
