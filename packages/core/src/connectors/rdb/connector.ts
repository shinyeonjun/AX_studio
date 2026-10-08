import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { createHash } from 'node:crypto';
import { rdbConnectionIdentity } from './config/validate.js';
import { tableArtifactFromRows } from '../../contracts/artifacts/table-build.js';
import { partialArtifactCompleteness } from '../../contracts/artifacts/completeness.js';
import { describeRdbTablePage, parseRdbMetadataPage } from './client/describe.js';
import {
  formatRdbTableRef,
  isAllowedRdbTable,
  listRdbTables,
  MAX_RDB_OFFSET,
  MAX_RDB_RESULT_ROWS,
  normalizeRdbRowLimit,
  parseRdbTableRef,
  readRdbRows,
  resolveRdbTableRef,
} from './client.js';
import type { RdbConnectionConfig } from './client/types.js';
import { prepareRdbRows, RdbScalarReadError } from './client/scalars.js';
import { parseRdbJoins, RdbJoinError, readRdbJoinedRows } from './client/join.js';
import type { RdbReadCoverage, RdbReadScope } from '../../contracts/artifacts/rdb-read.js';
import { DEFAULT_RDB_DATABASE_ID, matchRdbDatabase, type RdbDatabase } from './config/databases.js';

export type { RdbConnectionConfig } from './client/types.js';

export class RdbConnector implements Connector {
  name = 'rdb';
  private readonly databases: readonly RdbDatabase[];

  /** One database (a connection saved before several were possible) or the connection's list. */
  constructor(config: RdbConnectionConfig | readonly RdbDatabase[]) {
    this.databases = Array.isArray(config) ? config : [{ ...(config as RdbConnectionConfig), id: DEFAULT_RDB_DATABASE_ID }];
  }

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (ctx.abortSignal?.aborted) return { ok: false, error: 'rdb_aborted', errorCode: 'aborted' };
    const fields = action === 'schema.describe' ? ['connectionId'] : action === 'table.describe' ? ['table', 'offset', 'limit', 'connectionId'] : ['table', 'offset', 'limit', 'join', 'connectionId'];
    if (Object.keys(params).some(key => !fields.includes(key))) {
      return { ok: false, error: 'rdb_read_only_fields_required', errorCode: 'policy_denied' };
    }
    const connectionId = typeof params.connectionId === 'string' ? params.connectionId : undefined;
    if (params.connectionId !== undefined && typeof params.connectionId !== 'string') {
      return { ok: false, error: 'rdb_connection_not_found', errorCode: 'invalid_params' };
    }
    // Which database: the one named, or the only/default one. Several and none named is an error.
    const database = matchRdbDatabase(this.databases, connectionId);
    if (!database) {
      return connectionId?.trim()
        ? { ok: false, error: 'rdb_connection_not_found', errorCode: 'invalid_params' }
        : { ok: false, error: 'rdb_connection_required', errorCode: 'invalid_params' };
    }
    return this.executeOn(database, action, params, ctx);
  }

  private async executeOn(database: RdbDatabase, action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const config: RdbConnectionConfig = database;
    const rowLimit = normalizeRdbRowLimit(config.rowLimit, 1000);

    if (action === 'schema.describe') {
      try {
        const tables = await listRdbTables(config, ctx.abortSignal);
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
      const ref = resolveRdbTableRef(config, parsedRef);
      if (!isAllowedRdbTable(config, ref)) {
        return { ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' };
      }
      const joins = parseRdbJoins(params.join);
      if (!joins) return { ok: false, error: 'invalid_join', errorCode: 'invalid_params' };

      try {
        if (action === 'table.describe') {
          const pagination = parseRdbMetadataPage(params.offset, params.limit);
          if (!pagination) return { ok: false, error: 'invalid_metadata_pagination', errorCode: 'invalid_params' };
          const page = await describeRdbTablePage(config, ref, pagination, ctx.abortSignal);
          ctx.abortSignal?.throwIfAborted();
          return page.columns.length || page.offset > 0 ? { ok: true, data: { table: formatRdbTableRef(ref), ...page } }
            : { ok: false, error: 'rdb_table_metadata_unavailable', errorCode: 'rdb_error' };
        }
        // Report capture is a host-owned mode. Never trust a model/request
        // field for this privilege or an interactive read could bypass its
        // configured row limit.
        const reportCapture = ctx.reportCapture === true;
        const requestedLimit = reportCapture
          ? normalizeRdbRowLimit(params.limit, MAX_RDB_RESULT_ROWS)
          : params.limit === undefined
            ? rowLimit
            : Math.min(rowLimit, normalizeRdbRowLimit(params.limit, rowLimit));
        const rawOffset = params.offset;
        const offset = rawOffset === undefined ? 0
          : typeof rawOffset === 'number' ? rawOffset : Number.NaN;
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RDB_OFFSET) {
          return { ok: false, error: 'invalid_row_pagination', errorCode: 'invalid_params' };
        }
        const rows = joins.length > 0
          ? await readRdbJoinedRows(config, ref, joins, requestedLimit + 1, ctx.abortSignal, { offset })
          : await readRdbRows(config, ref, requestedLimit + 1, ctx.abortSignal, { offset });
        ctx.abortSignal?.throwIfAborted();
        const queryFingerprint = createHash('sha256').update(JSON.stringify({
          schemaVersion: 1,
          database: config.type,
          ...(database.id !== DEFAULT_RDB_DATABASE_ID ? { connectionId: database.id } : {}),
          // Bind identity to the configured source without exposing its path,
          // credentials or connection string in the resulting artifact.
          connection: config.connectionString
            ? rdbConnectionIdentity(config.connectionString)
            : config.filePath ?? null,
          allowedSchemas: [...(config.allowedSchemas ?? [])].sort(),
          allowedTables: [...(config.allowedTables ?? [])].sort(),
          table: formatRdbTableRef(ref),
          ...(joins.length > 0 ? { joins } : {}),
          accessMode: 'read_only', projection: 'all_columns', predicate: 'none', pagination: 'offset',
        })).digest('hex');
        const tableLabel = [formatRdbTableRef(ref), ...joins.map((join) => join.table)].join(' + ');
        const preparedRows = prepareRdbRows(rows);
        // Stopped early by the page byte budget: report a partial page and let
        // the caller continue from the next offset.
        const byteLimited = preparedRows.length < Math.min(rows.length, requestedLimit);
        const table = tableArtifactFromRows(preparedRows, {
          id: `rdb_${ctx.executionId}_${tableLabel.replace(/[^A-Za-z0-9_]+/g, '_')}`,
          name: tableLabel,
          rowLimit: requestedLimit,
          preserveRawValues: true,
          scalarPolicy: 'preserve',
          source: {
            executionId: ctx.executionId,
            readOnlyEnforced: true,
            database: config.type,
            ...(database.label ? { connectionLabel: database.label } : {}),
            schema: ref.schema,
            table: ref.table,
            queryFingerprint,
            capturedAt: new Date().toISOString(),
          },
        });
        if (!table) return { ok: false, error: 'rdb_rows_invalid', errorCode: 'rdb_error' };
        if (byteLimited) {
          table.truncated = true;
          table.completeness = partialArtifactCompleteness('response_byte_limit', {
            observedCount: table.rows.length, limit: requestedLimit, hasMore: true,
          });
        }
        const readScope: RdbReadScope = {
          schemaVersion: 1, kind: 'page', queryFingerprint, table: formatRdbTableRef(ref),
          ...(joins.length > 0 ? { joins } : {}),
          accessMode: 'read_only', projection: 'all_columns', predicate: 'none', pagination: 'offset', scalarPolicy: 'preserve',
          offset, limit: requestedLimit,
        };
        const coverage: RdbReadCoverage = {
          schemaVersion: 1, page: 'complete',
          query: table.truncated || offset > 0 ? 'partial' : 'unknown',
          source: table.truncated || offset > 0 ? 'partial' : 'unknown',
          consistency: 'best_effort', reason: 'independent_offset_reads',
          observedRows: table.rows.length, hasMore: table.truncated,
        };
        // Keep the provider page boundary visible to generic model callers.
        // The table rows remain bounded by the configured limit, while a
        // caller can continue from the exact next offset when more rows exist.
        const data = {
          ...table,
          readScope,
          coverage,
          offset,
          ...(table.truncated ? { nextOffset: offset + table.rows.length } : {}),
        };
        ctx.variables.queryResult = data;
        return { ok: true, data };
      } catch (error) {
        if (ctx.abortSignal?.aborted) return { ok: false, error: 'rdb_aborted', errorCode: 'aborted' };
        if (error instanceof RdbJoinError) {
          return { ok: false, error: error.reason, errorCode: error.reason === 'join_key_not_unique' ? 'rdb_error' : 'policy_denied' };
        }
        if (error instanceof RdbScalarReadError) {
          return { ok: false, error: error.reason, errorCode: error.errorCode };
        }
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
