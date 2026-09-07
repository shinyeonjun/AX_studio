import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { tableArtifactFromRows } from '../../contracts/artifacts/table-build.js';
import { describeRdbTablePage, parseRdbMetadataPage } from './client/describe.js';
import {
  formatRdbTableRef,
  isAllowedRdbTable,
  listRdbTables,
  normalizeRdbRowLimit,
  parseRdbTableRef,
  readRdbRows,
  resolveRdbTableRef,
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
    if (ctx.abortSignal?.aborted) return { ok: false, error: 'rdb_aborted', errorCode: 'aborted' };
    const rowLimit = normalizeRdbRowLimit(this.config.rowLimit, 1000);

    if (action === 'schema.describe') {
      try {
        const tables = await listRdbTables(this.config, ctx.abortSignal);
        ctx.abortSignal?.throwIfAborted();
        return { ok: true, data: tables.map(formatRdbTableRef) };
      } catch (error) {
        if (ctx.abortSignal?.aborted) return { ok: false, error: 'rdb_aborted', errorCode: 'aborted' };
        ctx.log({
          at: new Date().toISOString(),
          level: 'error',
          message: 'rdb.schema_failed',
          data: { error: error instanceof Error ? error.message : String(error) },
        });
        return { ok: false, error: 'rdb_schema_failed', errorCode: 'rdb_error' };
      }
    }

    if (action === 'table.describe' || action === 'query.read' || action === 'query') {
      const parsedRef = parseRdbTableRef(params.table);
      if (!parsedRef) {
        return { ok: false, error: 'invalid_table_name', errorCode: 'policy_denied' };
      }
      const ref = resolveRdbTableRef(this.config, parsedRef);
      if (!isAllowedRdbTable(this.config, ref)) {
        return { ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' };
      }

      try {
        if (action === 'table.describe') {
          const pagination = parseRdbMetadataPage(params.offset, params.limit);
          if (!pagination) return { ok: false, error: 'invalid_metadata_pagination', errorCode: 'invalid_params' };
          const page = await describeRdbTablePage(this.config, ref, pagination, ctx.abortSignal);
          ctx.abortSignal?.throwIfAborted();
          return page.columns.length || page.offset > 0 ? { ok: true, data: { table: formatRdbTableRef(ref), ...page } }
            : { ok: false, error: 'rdb_table_metadata_unavailable', errorCode: 'rdb_error' };
        }
        const rows = await readRdbRows(this.config, ref, rowLimit + 1, ctx.abortSignal);
        ctx.abortSignal?.throwIfAborted();
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
        if (ctx.abortSignal?.aborted) return { ok: false, error: 'rdb_aborted', errorCode: 'aborted' };
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
