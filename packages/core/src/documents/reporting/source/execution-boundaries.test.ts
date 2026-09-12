import { afterEach, expect, it, vi } from 'vitest';
import { ReportGenerationService } from '../service.js';
import { executeHttpAction } from '../../../connectors/http/connector/execute.js';
import { captureReportSources } from './capture.js';
import { probeReportHttpSources } from './probe.js';
import { performHttpRequest } from '../../../connectors/http/request.js';
import { HttpResponseArtifactSchema, httpResponseToTable } from '../../../contracts/artifacts/http-response.js';
import type { ConnectorContext } from '../../../connectors/types.js';
vi.mock('../../../connectors/http/request.js', () => ({ performHttpRequest: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const period = { start: '2026-01-01', endInclusive: '2026-01-31', label: 'January' };
const pagination = { pageParam: 'page', sizeParam: 'size', pageSize: 1, totalPagesPath: 'totalPages', maxPages: 10, currentPagePath: 'page' };
const plan = { schemaVersion: 1 as const, http: [{ alias: 'data', connectionId: 'allowed', path: '/data', rowsPath: 'rows', pagination }], rdb: [] };
function gateway() {
  return {
    executeHttp: (params: Record<string, unknown>) => executeHttpAction(
      [{ id: 'allowed', baseUrl: 'https://fixture.test' }], 'request', params,
      { executionId: 'review', variables: {}, log: vi.fn() },
    ),
    executeRdb: vi.fn(),
  };
}
function pageResponse(page: number, options: { truncated?: boolean; status?: number; totalPages?: number; next?: boolean } = {}) {
  return { ok: true as const, status: options.status ?? 200, statusText: 'OK',
    headers: { link: (options.next ?? page === 1) ? '<https://fixture.test/data?page=2>; rel="next"' : '' },
    body: JSON.stringify({ rows: [{ id: page }], totalPages: options.totalPages ?? 2, page }), truncated: options.truncated ?? false };
}

it.each(['missing', 'goal', 'goal-comma', 'goal-period', 'goal-parentheses', 'goal-quoted', 'configured'] as const)('validates final-plan route provenance before calling the connector, evidence=%s', async evidence => {
  const execute = vi.fn(async () => ({ ok: false, errorCode: 'fixture_stop' }));
  const service = new ReportGenerationService({
    workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
    documentEngine: { pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }), pdfFormFill: vi.fn() },
    planner: {
      inferSourceRequirements: async () => [],
      inferCapturePlan: async () => ({ schemaVersion: 1, examplePeriod: period, targetPeriod: period,
        capturePlan: { schemaVersion: 1, http: [{ alias: 'data', connectionId: 'allowed', path: '/invented-admin-export', rowsPath: '$' }], rdb: [] } }),
      refineCapturePlan: vi.fn(), inferReportPlan: vi.fn(),
    }, getConnector: name => name === 'http' ? { name: 'http', execute } : undefined,
  });
  const goals: Record<string, string> = {
    goal: 'Use /invented-admin-export for the report',
    'goal-comma': '주문 API는 GET /invented-admin-export, 모든 페이지를 조회해.',
    'goal-period': 'Use /invented-admin-export. Read every page.',
    'goal-parentheses': '주문 경로(/invented-admin-export)를 사용해.',
    'goal-quoted': "Use '/invented-admin-export' for the report.",
  };
  const result = await service.generate({ goal: goals[evidence] ?? 'Create a monthly report', templateSourceId: 't', exampleSourceId: 'e' }, {
    workspaceSessionId: 'review', connections: [
      { connector: 'http', connected: true, config: { endpoints: [{ id: 'allowed', baseUrl: 'https://fixture.test' }] } },
      ...(evidence === 'configured' ? [{ connector: 'openapi', connected: true, config: {
        specId: 'review', baseUrl: 'https://fixture.test', specJson: { openapi: '3.0.0',
          info: { title: 'Review', version: '1' }, servers: [{ url: 'https://fixture.test' }], paths: { '/invented-admin-export': {
            get: { operationId: 'readExport', responses: { '200': { description: 'Export rows' } } },
          } },
        },
      } }] : []),
    ], artifactSink: { putBytes: vi.fn() }, log: vi.fn(),
  } as unknown as ConnectorContext);
  if (evidence !== 'missing') {
    expect(execute).toHaveBeenCalledWith('request', { connectionId: 'allowed', method: 'GET', path: '/invented-admin-export' }, expect.anything());
  } else {
    expect(result.errorCode).toBe('report_http_path_not_in_report_evidence');
    expect(execute).not.toHaveBeenCalled();
  }
});

it('inspects an intact page and captures all Link-paginated pages using the explicit contract', async () => {
  vi.mocked(performHttpRequest).mockResolvedValueOnce(pageResponse(1));
  expect(await probeReportHttpSources(plan, gateway())).toHaveLength(1);
  vi.mocked(performHttpRequest).mockResolvedValueOnce(pageResponse(1)).mockResolvedValueOnce(pageResponse(2));
  const captured = await captureReportSources(plan, period, gateway());
  expect(captured.data.rows).toEqual([{ id: 1 }, { id: 2 }]);
  expect(captured.data.complete).toBe(true);
  expect(performHttpRequest).toHaveBeenCalledTimes(3);
});

it.each(['no-contract', 'bytes', 'partial-content', 'contradictory-last-page'] as const)('rejects incomplete capture: %s', async mode => {
  vi.mocked(performHttpRequest).mockResolvedValue(pageResponse(1, {
    truncated: mode === 'bytes', status: mode === 'partial-content' ? 206 : 200,
    totalPages: mode === 'contradictory-last-page' ? 1 : 2,
  }));
  const selected = mode === 'no-contract' ? { ...plan, http: [{ ...plan.http[0]!, pagination: undefined }] } : plan;
  await expect(captureReportSources(selected, period, gateway())).rejects.toThrow(
    mode === 'contradictory-last-page' ? 'report_http_total_pages_inconsistent' : 'report_http_response_incomplete',
  );
  expect(performHttpRequest).toHaveBeenCalledTimes(1);
});

it('preserves dataset incompleteness when an intact page becomes a table', async () => {
  vi.mocked(performHttpRequest).mockResolvedValue(pageResponse(1));
  const response = await gateway().executeHttp({ path: '/data' });
  const table = httpResponseToTable(HttpResponseArtifactSchema.parse(response.data), { sourceId: 'data', rowsPath: 'rows' });
  expect(table).toMatchObject({ ok: true, table: { truncated: true, completeness: { status: 'partial', reason: 'provider_limit', hasMore: true } } });
});
