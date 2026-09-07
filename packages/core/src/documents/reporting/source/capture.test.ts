import { describe, expect, it, vi } from 'vitest';
import { buildHttpResponseArtifact } from '../../../contracts/artifacts/http-response.js';
import { tableArtifactFromRows } from '../../../contracts/artifacts/table-build.js';
import { captureReportSources } from './capture.js';
import { probeReportHttpSources, probeReportHttpSourcesWithRecovery } from './probe.js';
import type { ReportSourceCapturePlan, ReportSourceGateway } from './schema.js';
import { assertReportSourceCoverage, type ReportCaptureInference } from '../planner/schema.js';

it.each(Array.from({ length: 20 }, (_, seed) => seed))('checks coverage independent of source names/order, variant %s', seed => {
  const connector = seed % 2 ? 'rdb' : 'http';
  const alias = `source_${(seed * 7919 + 17).toString(36)}`;
  const need = { id: `need_${seed}`, connector, description: 'Required business facts', reason: 'Explicit request' } as const;
  const capture: ReportCaptureInference = { schemaVersion: 1,
    examplePeriod: { start: '2041-01-01', endInclusive: '2041-01-31', label: 'past' },
    targetPeriod: { start: '2041-02-01', endInclusive: '2041-02-28', label: 'next' },
    capturePlan: { schemaVersion: 1,
      http: connector === 'http' ? [{ alias, connectionId: `connection_${seed}`, path: `/v${seed}/facts`, rowsPath: '$' }] : [],
      rdb: connector === 'rdb' ? [{ alias, table: `schema_${seed}.facts` }] : [] },
    requirementBindings: [{ requirementId: need.id, aliases: [alias] }],
  };
  expect(() => assertReportSourceCoverage(capture, [need])).not.toThrow();
  expect(() => assertReportSourceCoverage({ ...capture, requirementBindings: [] }, [need])).toThrow('report_source_replan_required');
  expect(() => assertReportSourceCoverage({ ...capture, requirementBindings: [
    { requirementId: need.id, aliases: ['invented'] },
  ] }, [need])).toThrow('report_source_replan_required');
  expect(() => assertReportSourceCoverage(capture, [{ ...need, connector: connector === 'rdb' ? 'http' : 'rdb' }])).toThrow('report_source_replan_required');
});

it('rejects a plan that omits a required transport even if its remaining sources are valid', () => {
  expect(() => assertReportSourceCoverage({ schemaVersion: 1,
    examplePeriod: { start: '2031-01-01', endInclusive: '2031-01-31', label: 'example' },
    targetPeriod: { start: '2031-02-01', endInclusive: '2031-02-28', label: 'target' },
    capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'directory', table: 'directory' }] },
    requirementBindings: [{ requirementId: 'transactions', aliases: ['directory'] }],
  }, [{ id: 'transactions', connector: 'http', description: 'Transaction history', reason: 'User explicitly requested the connected transaction API' }]))
    .toThrow('report_source_replan_required');
});

it('retains the status from a failed connector probe without disclosing its response body', async () => {
  await expect(probeReportHttpSources({ schemaVersion: 1,
    http: [{ alias: 'ledger', connectionId: 'selected', path: '/records', rowsPath: '$' }], rdb: [],
  }, { executeHttp: async () => ({ ok: false, error: 'http_404', errorCode: 'http_error' }) }))
    .rejects.toThrow('report_http_probe_status:ledger:404');
});

it('removes one rejected static query only after a successful bare-path recovery probe', async () => {
  const executeHttp = vi.fn()
    .mockResolvedValueOnce({ ok: false, error: 'http_400', errorCode: 'http_error' })
    .mockResolvedValueOnce({ ok: true, data: buildHttpResponseArtifact({
      executionId: 'bare', url: 'http://example.test/records', status: 200,
      statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '[]',
    }) });
  const result = await probeReportHttpSourcesWithRecovery({ schemaVersion: 1, rdb: [], http: [{
    alias: 'ledger', connectionId: 'selected', path: '/records', rowsPath: '$',
    staticQuery: { status: 'all' },
  }] }, { executeHttp });

  expect(executeHttp.mock.calls.map(([params]) => params)).toEqual([
    { connectionId: 'selected', method: 'GET', path: '/records?status=all' },
    { connectionId: 'selected', method: 'GET', path: '/records' },
  ]);
  expect(result.plan.http[0]).toMatchObject({ alias: 'ledger', path: '/records' });
  expect(result.plan.http[0]).not.toHaveProperty('staticQuery');
  expect(result.probes).toHaveLength(1);
  expect(result.corrections).toEqual([{ alias: 'ledger', status: 400, queryKeys: ['status'] }]);
});

it.each([401, 403, 404, 500])('does not remove a static query for non-parameter status %s', async status => {
  const executeHttp = vi.fn().mockResolvedValue({ ok: false, error: `http_${status}`, errorCode: 'http_error' });
  await expect(probeReportHttpSourcesWithRecovery({ schemaVersion: 1, rdb: [], http: [{
    alias: 'ledger', connectionId: 'selected', path: '/records', rowsPath: '$', staticQuery: { status: 'all' },
  }] }, { executeHttp })).rejects.toThrow(`report_http_probe_status:ledger:${status}`);
  expect(executeHttp).toHaveBeenCalledTimes(1);
});

it('rejects absolute or off-origin report paths before contacting the HTTP gateway', async () => {
  const executeHttp = vi.fn();
  await expect(probeReportHttpSources({ schemaVersion: 1,
    http: [{ alias: 'ledger', connectionId: 'selected', path: 'https://private.example/records', rowsPath: '$' }], rdb: [],
  }, { executeHttp })).rejects.toThrow('report_http_path_invalid');
  expect(executeHttp).not.toHaveBeenCalled();
});

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
  it('pages a partial RDB response until the complete snapshot is available', async () => {
    const allRows = Array.from({ length: 5 }, (_, id) => ({ id }));
    const executeRdb = vi.fn(async (params: Record<string, unknown>) => {
      const offset = Number(params.offset ?? 0);
      const pageLimit = 2;
      const pageRows = allRows.slice(offset, offset + pageLimit + 1);
      return { ok: true, data: tableArtifactFromRows(pageRows, {
        id: 'rdb-page', rowLimit: pageLimit,
      }) };
    });
    const result = await captureReportSources({ schemaVersion: 1, http: [], rdb: [
      { alias: 'facts', table: 'public.facts' },
    ] }, { start: '2032-02-01', endInclusive: '2032-02-29', label: 'period' }, {
      executeHttp: vi.fn(), executeRdb,
    });

    expect(executeRdb.mock.calls.map(([params]) => params)).toEqual([
      { table: 'public.facts', offset: 0, limit: 10_000 },
      { table: 'public.facts', offset: 2, limit: 10_000 },
      { table: 'public.facts', offset: 4, limit: 10_000 },
    ]);
    expect(result.facts).toMatchObject({ complete: true, rows: allRows });
  });

  it('fails closed when an RDB continuation reports more rows but returns none', async () => {
    const executeRdb = vi.fn(async (params: Record<string, unknown>) => ({
      ok: true,
      data: tableArtifactFromRows(Number(params.offset) === 0 ? [{ id: 1 }, { id: 2 }, { id: 3 }] : [], {
        id: 'rdb-page', rowLimit: 2,
      }),
    }));
    await expect(captureReportSources({ schemaVersion: 1, http: [], rdb: [
      { alias: 'facts', table: 'public.facts' },
    ] }, { start: '2032-02-01', endInclusive: '2032-02-29', label: 'period' }, {
      executeHttp: vi.fn(), executeRdb,
    })).rejects.toThrow('report_rdb_pagination_no_progress:facts');
  });

  it('fails closed when an RDB continuation repeats the previous page', async () => {
    const executeRdb = vi.fn(async () => ({
      ok: true,
      data: tableArtifactFromRows([{ id: 1 }, { id: 2 }, { id: 3 }], {
        id: 'rdb-page', rowLimit: 2,
      }),
    }));
    await expect(captureReportSources({ schemaVersion: 1, http: [], rdb: [
      { alias: 'facts', table: 'public.facts' },
    ] }, { start: '2032-02-01', endInclusive: '2032-02-29', label: 'period' }, {
      executeHttp: vi.fn(), executeRdb,
    })).rejects.toThrow('report_rdb_pagination_no_progress:facts');
    expect(executeRdb).toHaveBeenCalledTimes(2);
  });

  it('captures every page when row and pagination paths include the JSON root', async () => {
    const result = await captureReportSources({ schemaVersion: 1, rdb: [], http: [{
      alias: 'orders', path: '/orders', rowsPath: '$.data', pagination: {
        pageParam: 'page', sizeParam: 'size', pageSize: 1, maxPages: 3,
        totalPagesPath: '$.meta.total_pages', currentPagePath: '$.meta.page',
      },
    }] }, { start: '2032-02-01', endInclusive: '2032-02-29', label: 'period' }, {
      executeRdb: vi.fn(),
      executeHttp: async params => {
        const url = new URL(String(params.path), 'http://example.test');
        const page = Number(url.searchParams.get('page'));
        return { ok: true, data: buildHttpResponseArtifact({
          executionId: `rooted-${page}`, url: url.href, status: 200, statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ data: [{ id: page }], meta: { total_pages: 2, page } }),
        }) };
      },
    });
    expect(result.orders?.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.orders?.complete).toBe(true);
  });

  it('fails closed when an HTTP pagination request returns the same page again', async () => {
    const executeHttp = vi.fn(async (params: Record<string, unknown>) => {
      const url = new URL(String(params.path), 'http://example.test');
      const page = Number(url.searchParams.get('page'));
      return { ok: true, data: buildHttpResponseArtifact({
        executionId: `repeat-${page}`, url: url.href, status: 200, statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ data: [{ id: 1 }], meta: { total_pages: 3 } }),
      }) };
    });
    await expect(captureReportSources({ schemaVersion: 1, rdb: [], http: [{
      alias: 'orders', path: '/orders', rowsPath: '$.data', pagination: {
        pageParam: 'page', sizeParam: 'size', pageSize: 1, maxPages: 3,
        totalPagesPath: '$.meta.total_pages',
      },
    }] }, { start: '2032-02-01', endInclusive: '2032-02-29', label: 'period' }, {
      executeRdb: vi.fn(), executeHttp,
    })).rejects.toThrow('report_http_pagination_no_progress:orders:2');
    expect(executeHttp).toHaveBeenCalledTimes(2);
  });
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
