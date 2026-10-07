import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { ConnectorContext } from '../../../connectors/types.js';
import { parseHttpEndpoints } from '../../../connectors/http/connection.js';
import { parseOpenApiConnectionConfig } from '../../../connectors/protocols/openapi/connection.js';
import {
  parseOpenApiSpec,
  type OpenApiOperation,
} from '../../../connectors/protocols/openapi/parse.js';
import type { ReportHttpConnectionSummary } from '../planner/planner.js';
import { normalizeReportHttpPath } from '../source/schema.js';

export function httpConnectionSummaries(ctx: ConnectorContext): ReportHttpConnectionSummary[] {
  const config = ctx.connections?.find((connection) => connection.connector === 'http' && connection.connected)?.config;
  const documented = ctx.connections?.find((connection) => connection.connector === 'openapi' && connection.connected);
  let operationSource: { origin: string; basePath: string; operations: OpenApiOperation[] } | undefined;
  try {
    const openapi = parseOpenApiConnectionConfig(documented?.config);
    if (openapi) {
      const url = new URL(openapi.baseUrl);
      const spec = parseOpenApiSpec(openapi.specId, openapi.specJson, openapi.baseUrl);
      operationSource = { origin: url.origin, basePath: url.pathname.replace(/\/$/, ''),
        operations: spec.operations.filter(operation => operation.method === 'GET'
          && operation.sideEffect === 'NONE'
          && !/[{}?#]/.test(operation.path)
          && normalizeReportHttpPath(operation.path) === operation.path) };
    }
  } catch {
    // An invalid or unsupported spec cannot authorize a route inspection.
  }
  return parseHttpEndpoints(config).flatMap((endpoint) => {
    try {
      const url = new URL(endpoint.baseUrl);
      const operations = operationSource?.origin === url.origin
        && operationSource.basePath === url.pathname.replace(/\/$/, '') ? operationSource.operations : [];
      return [{ id: endpoint.id, label: endpoint.label?.trim() || endpoint.id, origin: url.origin, basePath: url.pathname || '/',
        ...(operations.length ? { operations } : {}) }];
    } catch {
      return [];
    }
  });
}

export function httpInspectionFailure(error: unknown): { reason: string; status?: number; errorCode?: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const status = /^report_http_probe_status:[^:]+:(\d{3})$/.exec(raw)?.[1];
  if (status) return { reason: 'http_status', status: Number(status) };
  const connectorCode = /^report_http_probe_failed:[^:]+:([a-z][a-z0-9_.-]{0,96})$/i.exec(raw)?.[1];
  if (connectorCode) return { reason: 'http_probe_failed', errorCode: connectorCode };
  if (/^report_http_probe_(?:incomplete|not_json|response_invalid):/.test(raw)) {
    return { reason: 'http_response_invalid' };
  }
  return { reason: 'http_probe_failed' };
}

export function reportHttpEvidencePathnames(goal: string, pair: PdfReportPairAnalysis): Set<string> {
  const texts = [
    goal,
    ...pair.scalarSlots.map((slot) => slot.exampleText),
    ...pair.tableGroups.flatMap((group) => group.rows.flatMap((row) => row.cells.map((cell) => cell.exampleText))),
  ];
  const pathnames = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\/(?!\/)[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%\/-]{0,255}/g)) {
      const token = match[0];
      let prosePath = token.replace(/[.,;:']+$/, '');
      while (prosePath.endsWith(')') && prosePath.split(')').length > prosePath.split('(').length) {
        prosePath = prosePath.slice(0, -1);
      }
      // Keep the literal route too: punctuation can be a real URL character.
      for (const candidate of new Set([token, prosePath])) {
        try {
          const normalized = normalizeReportHttpPath(candidate);
          pathnames.add(new URL(normalized, 'http://report-probe.invalid').pathname);
        } catch {
          // A slash in prose is not evidence of a request route.
        }
      }
    }
  }
  return pathnames;
}
