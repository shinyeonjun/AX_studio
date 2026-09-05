import { describe, expect, it, vi } from 'vitest';
import { buildHttpResponseArtifact } from '../../contracts/artifacts/http-response.js';
import { tableArtifactFromRows } from '../../contracts/artifacts/table-build.js';
import { captureReportSources } from './capture.js';
import { probeReportHttpSources } from './probe.js';
import type { ReportSourceCapturePlan, ReportSourceGateway } from './schema.js';

const plan: ReportSourceCapturePlan = {
  schemaVersion: 1,
  http: [{
    alias: 'orders',
    connectionId: 'orders-api',
    path: '/api/v1/orders',
    rowsPath: 'data',
    dateQuery: { fromParam: 'from', toParam: 'to' },
    pagination: {
      pageParam: 'page',
      sizeParam: 'size',
      pageSize: 2,
      totalPagesPath: 'meta.total_pages',
      maxPages: 10,
    },
  }],
  rdb: [
    { alias: 'customers', table: 'public.customers' },
    { alias: 'contracts', table: 'public.contracts' },
  ],
};

function gateway(options: { truncatedPage?: number } = {}): ReportSourceGateway & {
  http: ReturnType<typeof vi.fn>;
  rdb: ReturnType<typeof vi.fn>;
} {
  const pages = [
    [{ id: 'o1' }, { id: 'o2' }],
    [{ id: 'o3' }, { id: 'o4' }],
    [{ id: 'o5' }],
  ];
  const http = vi.fn(async (params: Record<string, unknown>) => {
    const path = String(params.path);
    const page = Number(new URL(path, 'http://example.test').searchParams.get('page') ?? 1);
    return {
      ok: true,
      data: buildHttpResponseArtifact({
        executionId: `capture-${page}`,
        url: `http://example.test${path}`,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: pages[page - 1], meta: { total_pages: 3 } }),
        truncated: options.truncatedPage === page,
      }),
    };
  });
  const rdb = vi.fn(async (params: Record<string, unknown>) => ({
    ok: true,
    data: tableArtifactFromRows(
      [{ id: `${params.table}-1` }],
      { id: `table-${params.table}`, rowLimit: 10 },
    ),
  }));
  return { executeHttp: http, executeRdb: rdb, http, rdb };
}

describe('captureReportSources', () => {
  it('rejects impossible calendar dates before contacting a source', async () => {
    const sourceGateway = gateway();
    await expect(captureReportSources(plan, {
      start: '2031-02-29', endInclusive: '2031-03-01', label: 'invalid',
    }, sourceGateway)).rejects.toThrow('report_date_invalid');
    expect(sourceGateway.http).not.toHaveBeenCalled();
  });

  it('enforces a shared row budget across pages before reading later sources', async () => {
    const sourceGateway = gateway();
    await expect(captureReportSources(plan, {
      start: '2032-02-01', endInclusive: '2032-02-29', label: 'period',
    }, sourceGateway, { maxRows: 3 })).rejects.toThrow('report_capture_row_limit');
    expect(sourceGateway.http).toHaveBeenCalledTimes(2);
    expect(sourceGateway.rdb).not.toHaveBeenCalled();
  });

  it('supports a root-array response without inventing a wrapper', async () => {
    const result = await captureReportSources({ schemaVersion: 1, rdb: [], http: [
      { alias: 'entries', path: '/entries', rowsPath: '$' },
    ] }, { start: '2032-02-01', endInclusive: '2032-02-29', label: 'period' }, {
      executeRdb: vi.fn(),
      executeHttp: async () => ({ ok: true, data: buildHttpResponseArtifact({
        executionId: 'root', url: 'http://example.test/entries', status: 200,
        statusText: 'OK', headers: {}, body: '[{"id":"a"}]', truncated: false,
      }) }),
    });
    expect(result.entries.rows).toEqual([{ id: 'a' }]);
    expect(result.entries.provenance).toMatchObject({ consistency: 'unverified', source: '/entries' });
  });

  it('probes a selected endpoint with GET and exposes structure without row values', async () => {
    const sourceGateway = gateway();
    const probes = await probeReportHttpSources(plan, sourceGateway);

    expect(sourceGateway.http).toHaveBeenCalledTimes(1);
    expect(sourceGateway.http).toHaveBeenCalledWith({
      connectionId: 'orders-api',
      method: 'GET',
      path: '/api/v1/orders',
    });
    expect(probes).toEqual([expect.objectContaining({
      alias: 'orders',
      path: '/api/v1/orders',
      status: 200,
      shape: expect.objectContaining({ type: 'object' }),
    })]);
    expect(JSON.stringify(probes)).not.toContain('o1');
  });

  it('captures every declared HTTP page and only the explicitly selected DB tables', async () => {
    const sourceGateway = gateway();
    const result = await captureReportSources(plan, {
      start: '2026-09-01',
      endInclusive: '2026-09-30',
      label: '2026-09',
    }, sourceGateway);

    expect(sourceGateway.http).toHaveBeenCalledTimes(3);
    expect(sourceGateway.http.mock.calls.map(([params]) => String(params.path))).toEqual([
      '/api/v1/orders?from=2026-09-01&to=2026-09-30&page=1&size=2',
      '/api/v1/orders?from=2026-09-01&to=2026-09-30&page=2&size=2',
      '/api/v1/orders?from=2026-09-01&to=2026-09-30&page=3&size=2',
    ]);
    expect(sourceGateway.rdb.mock.calls.map(([params]) => params.table)).toEqual([
      'public.customers',
      'public.contracts',
    ]);
    expect(result.orders).toMatchObject({ complete: true, rows: [
      { id: 'o1' }, { id: 'o2' }, { id: 'o3' }, { id: 'o4' }, { id: 'o5' },
    ] });
    expect(result.orders.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.customers.complete).toBe(true);
  });

  it('fails closed when a provider response is byte-truncated', async () => {
    await expect(captureReportSources(plan, {
      start: '2026-09-01', endInclusive: '2026-09-30', label: '2026-09',
    }, gateway({ truncatedPage: 2 }))).rejects.toThrow('report_http_response_incomplete:orders:2');
  });

  it('rejects aliases that would silently overwrite another selected source', async () => {
    await expect(captureReportSources({
      ...plan,
      rdb: [{ alias: 'orders', table: 'public.customers' }],
    }, {
      start: '2026-09-01', endInclusive: '2026-09-30', label: '2026-09',
    }, gateway())).rejects.toThrow('report_source_alias_duplicate:orders');
  });
});
