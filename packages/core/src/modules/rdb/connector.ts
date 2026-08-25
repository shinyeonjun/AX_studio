import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import {
  formatRdbTableRef,
  isAllowedRdbTable,
  listRdbTables,
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
    const rowLimit = this.config.rowLimit ?? 1000;

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
        const rows = await readRdbRows(this.config, ref, rowLimit);
        ctx.variables.queryResult = rows;
        return { ok: true, data: rows };
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
