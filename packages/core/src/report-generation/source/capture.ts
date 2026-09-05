import { createHash } from 'node:crypto';
import { HttpResponseArtifactSchema } from '../../contracts/artifacts/http-response.js';
import { TableArtifactSchema } from '../../contracts/artifacts/table.js';
import {
  ReportPeriodSchema,
  ReportSourceCapturePlanSchema,
  type CapturedReportSources,
  type ReportHttpSourceSpec,
  type ReportPeriod,
  type ReportSourceCapturePlan,
  type ReportSourceGateway,
} from './schema.js';

const DUMMY_ORIGIN = 'http://report-source.invalid';

function valueAtPath(value: unknown, path: string): unknown {
  if (path === '$') return value;
  let current = value;
  for (const segment of path.split('.')) {
    if (!segment || !current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

function fingerprint(rows: Array<Record<string, unknown>>): string {
  return createHash('sha256').update(canonicalJson(rows)).digest('hex');
}

function assertUniqueAliases(plan: ReportSourceCapturePlan): void {
  const aliases = [...plan.http.map((source) => source.alias), ...plan.rdb.map((source) => source.alias)];
  const seen = new Set<string>();
  for (const alias of aliases) {
    if (seen.has(alias)) throw new Error(`report_source_alias_duplicate:${alias}`);
    seen.add(alias);
  }
}

function sourcePath(spec: ReportHttpSourceSpec, period: ReportPeriod, page?: number): string {
  const raw = spec.path.trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) {
    throw new Error(`report_http_path_invalid:${spec.alias}`);
  }
  const parsed = new URL(raw, DUMMY_ORIGIN);
  if (parsed.origin !== DUMMY_ORIGIN) throw new Error(`report_http_path_invalid:${spec.alias}`);

  for (const [key, value] of Object.entries(spec.staticQuery ?? {})) {
    parsed.searchParams.set(key, String(value));
  }
  if (spec.dateQuery) {
    parsed.searchParams.set(spec.dateQuery.fromParam, period.start);
    parsed.searchParams.set(spec.dateQuery.toParam, period.endInclusive);
  }
  if (spec.pagination) {
    parsed.searchParams.set(spec.pagination.pageParam, String(page ?? 1));
    parsed.searchParams.set(spec.pagination.sizeParam, String(spec.pagination.pageSize));
  }
  return `${parsed.pathname}${parsed.search}`;
}

function objectRows(value: unknown, path: string, alias: string, page: number): Array<Record<string, unknown>> {
  const selected = valueAtPath(value, path);
  if (!Array.isArray(selected)) throw new Error(`report_http_rows_path_invalid:${alias}:${page}`);
  if (!selected.every((row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row))) {
    throw new Error(`report_http_rows_invalid:${alias}:${page}`);
  }
  return selected as Array<Record<string, unknown>>;
}

async function captureHttpSource(
  spec: ReportHttpSourceSpec,
  period: ReportPeriod,
  gateway: ReportSourceGateway,
  consume: (rows: Array<Record<string, unknown>>) => void,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    if (spec.pagination && page > spec.pagination.maxPages) {
      throw new Error(`report_http_page_limit:${spec.alias}`);
    }
    const result = await gateway.executeHttp({
      ...(spec.connectionId ? { connectionId: spec.connectionId } : {}),
      method: 'GET',
      path: sourcePath(spec, period, page),
    });
    if (!result.ok) throw new Error(`report_http_request_failed:${spec.alias}:${page}:${result.errorCode ?? 'unknown'}`);

    const response = HttpResponseArtifactSchema.safeParse(result.data);
    if (!response.success) throw new Error(`report_http_response_invalid:${spec.alias}:${page}`);
    if (response.data.status < 200 || response.data.status >= 300) {
      throw new Error(`report_http_status:${spec.alias}:${page}:${response.data.status}`);
    }
    if (response.data.truncated || response.data.completeness.status !== 'complete') {
      throw new Error(`report_http_response_incomplete:${spec.alias}:${page}`);
    }

    let json: unknown;
    try {
      json = JSON.parse(response.data.body) as unknown;
    } catch {
      throw new Error(`report_http_response_not_json:${spec.alias}:${page}`);
    }
    const pageRows = objectRows(json, spec.rowsPath, spec.alias, page);
    consume(pageRows);
    for (const row of pageRows) rows.push(row);

    if (spec.pagination) {
      const reported = valueAtPath(json, spec.pagination.totalPagesPath);
      if (typeof reported !== 'number' || !Number.isInteger(reported) || reported < 0) {
        throw new Error(`report_http_total_pages_invalid:${spec.alias}:${page}`);
      }
      if (reported > spec.pagination.maxPages) throw new Error(`report_http_page_limit:${spec.alias}`);
      if (page > 1 && reported !== totalPages) {
        throw new Error(`report_http_total_pages_changed:${spec.alias}:${page}`);
      }
      totalPages = reported;
    }
  }
  return rows;
}

export interface ReportCaptureLimits {
  maxRows?: number;
  maxBytes?: number;
}

export async function captureReportSources(
  input: ReportSourceCapturePlan,
  periodInput: ReportPeriod,
  gateway: ReportSourceGateway,
  limits: ReportCaptureLimits = {},
): Promise<CapturedReportSources> {
  const plan = ReportSourceCapturePlanSchema.parse(input);
  const period = ReportPeriodSchema.parse(periodInput);
  assertUniqueAliases(plan);
  const maxRows = limits.maxRows ?? 100_000;
  const maxBytes = limits.maxBytes ?? 32 * 1024 * 1024;
  if (![maxRows, maxBytes].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('report_capture_budget_invalid');
  }
  let totalRows = 0;
  let totalBytes = 0;
  const consume = (rows: Array<Record<string, unknown>>) => {
    totalRows += rows.length;
    if (totalRows > maxRows) throw new Error('report_capture_row_limit');
    totalBytes += Buffer.byteLength(JSON.stringify(rows), 'utf8');
    if (totalBytes > maxBytes) throw new Error('report_capture_byte_limit');
  };

  const captured: CapturedReportSources = {};
  for (const spec of plan.http) {
    const startedAt = new Date().toISOString();
    const rows = await captureHttpSource(spec, period, gateway, consume);
    captured[spec.alias] = { id: spec.alias, rows, complete: true, fingerprint: fingerprint(rows),
      provenance: { source: spec.path, startedAt, completedAt: new Date().toISOString(),
        requestedPeriod: period, consistency: 'unverified' } };
  }
  for (const spec of plan.rdb) {
    const startedAt = new Date().toISOString();
    const result = await gateway.executeRdb({ table: spec.table });
    if (!result.ok) throw new Error(`report_rdb_request_failed:${spec.alias}:${result.errorCode ?? 'unknown'}`);
    const table = TableArtifactSchema.safeParse(result.data);
    if (!table.success) throw new Error(`report_rdb_response_invalid:${spec.alias}`);
    if (table.data.truncated || table.data.completeness?.status !== 'complete') {
      throw new Error(`report_rdb_response_incomplete:${spec.alias}`);
    }
    const rows = table.data.rows.map((row) => ({ ...row.values }));
    consume(rows);
    captured[spec.alias] = { id: spec.alias, rows, complete: true, fingerprint: fingerprint(rows),
      provenance: { source: spec.table, startedAt, completedAt: new Date().toISOString(),
        requestedPeriod: period, consistency: 'unverified' } };
  }
  return captured;
}
