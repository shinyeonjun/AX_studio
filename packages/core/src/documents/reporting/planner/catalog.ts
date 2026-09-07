import { normalizeReportHttpPath } from '../source/schema.js';
import type { ReportHttpConnectionSummary } from './planner.js';
import type { ReportSourceInspection } from './source-discovery.js';

export function reportSourceCatalogSummary(httpConnections: ReportHttpConnectionSummary[], rdbTables: string[]) {
  return { httpConnections: httpConnections.length,
    httpOperations: httpConnections.reduce((count, connection) => count + (connection.operations?.length ?? 0), 0),
    rdbTables: rdbTables.length };
}

// The complete configured catalog stays on the host. Search scans every candidate;
// only this page crosses the model boundary. Never globally truncate the catalog.
export function inspectReportCatalog(
  httpConnections: ReportHttpConnectionSummary[], rdbTables: string[],
  request: Extract<ReportSourceInspection, { kind: 'catalog' | 'http_operation' }>,
) {
  if (request.kind === 'http_operation') {
    const connection = httpConnections.find(item => item.id === request.connectionId);
    const pathname = new URL(normalizeReportHttpPath(request.path), 'http://report-probe.invalid').pathname;
    const operation = connection?.operations?.find(item => item.path === pathname);
    if (!connection || !operation) return { available: false, reason: 'operation_metadata_unavailable' };
    return { available: true, connectionId: connection.id, label: connection.label.slice(0, 300),
      origin: connection.origin, basePath: connection.basePath, operation };
  }
  const page = catalogPage(httpConnections, rdbTables, request);
  if (page.total === 0 && request.query?.trim()) {
    const { query: _query, ...scope } = request;
    const browseRequest = { ...scope, offset: 0, limit: request.limit ?? 8 };
    return { ...page, recovery: { reason: 'no_metadata_match', request: browseRequest,
      page: catalogPage(httpConnections, rdbTables, browseRequest) } };
  }
  return page;
}

function catalogPage(httpConnections: ReportHttpConnectionSummary[], rdbTables: string[],
  request: Extract<ReportSourceInspection, { kind: 'catalog' }>) {
  const offset = request.offset ?? 0;
  const limit = request.limit ?? 8;
  const terms = (request.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const entries: Record<string, unknown>[] = [];
  let total = 0;
  let chars = 0;
  let pageFull = false;
  const visit = (entry: Record<string, unknown>, searchable: () => string) => {
    if (terms.length) {
      const text = searchable().toLowerCase();
      if (!terms.every(term => text.includes(term))) return;
    }
    const index = total++;
    if (index < offset || pageFull) return;
    const size = JSON.stringify(entry).length;
    if (entries.length >= limit || chars + size > 18_000) {
      if (!entries.length) throw new Error('report_source_discovery_evidence_limit');
      pageFull = true;
      return;
    }
    entries.push(entry);
    chars += size;
  };
  if (request.connector !== 'rdb') {
    for (const connection of httpConnections) {
      if (request.connectionId && connection.id !== request.connectionId) continue;
      const { operations, ...identity } = connection;
      const identityText = JSON.stringify(identity);
      const summary = { connectionId: connection.id, label: connection.label.slice(0, 300),
        origin: connection.origin, basePath: connection.basePath };
      visit({ kind: 'http_connection', ...summary, operationCount: operations?.length ?? 0 }, () => identityText);
      for (const operation of operations ?? []) {
        visit({ kind: 'http_operation', ...summary, operationId: operation.operationId,
          path: operation.path, summary: operation.summary?.slice(0, 300) }, () => `${identityText} ${JSON.stringify(operation)}`);
      }
    }
  }
  if (request.connector !== 'http' && !request.connectionId) {
    for (const table of rdbTables) visit({ kind: 'rdb_table', table }, () => table);
  }
  const hasMore = offset + entries.length < total;
  return { entries, total, offset, limit, hasMore, nextOffset: hasMore ? offset + entries.length : null,
    complete: offset === 0 && !hasMore };
}

export function selectedReportHttpMetadata(httpConnections: ReportHttpConnectionSummary[],
  selections: Array<{ connectionId?: string; path: string }>) {
  return httpConnections.filter(connection => selections.some(source => source.connectionId === connection.id))
    .map(connection => ({ ...connection, operations: connection.operations?.filter(operation => selections.some(source =>
      source.connectionId === connection.id
      && new URL(normalizeReportHttpPath(source.path), 'http://report-probe.invalid').pathname === operation.path)) }));
}
