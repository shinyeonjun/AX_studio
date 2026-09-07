import { describe, expect, it, vi } from 'vitest';
import { buildHttpResponseArtifact } from '../../../contracts/artifacts/http-response.js';
import { captureReportSources } from './capture.js';
import type { ReportHttpSourceSpec } from './schema.js';

const period = { start: '2040-01-01', endInclusive: '2040-01-31', label: 'period' };
const pagination = { pageParam: 'page', sizeParam: 'size', pageSize: 2, totalPagesPath: 'pages', maxPages: 5 };
function capture(spec: ReportHttpSourceSpec, response: (page: number) => unknown) {
  const executeHttp = vi.fn(async (params: Record<string, unknown>) => ({ ok: true,
    data: buildHttpResponseArtifact({ executionId: 'pagination', url: `https://api.test${params.path}`,
      status: 200, statusText: 'OK', headers: {}, truncated: false,
      body: JSON.stringify(response(Number(new URL(String(params.path), 'https://api.test').searchParams.get('page')))) }),
  }));
  return { executeHttp, result: captureReportSources({ schemaVersion: 1, http: [spec], rdb: [] },
    period, { executeHttp, executeRdb: vi.fn() }) };
}

describe('report page-number capture', () => {
  it('captures a configured zero-based API without omitting the first page', async () => {
    const { result, executeHttp } = capture({ alias: 'records', path: '/records', rowsPath: 'rows',
      pagination: { ...pagination, startPage: 0 } },
    page => ({ rows: page < 2 ? [{ id: `record-${page}` }] : [], pages: 2 }));
    expect((await result).records.rows).toEqual([{ id: 'record-0' }, { id: 'record-1' }]);
    expect(executeHttp).toHaveBeenCalledTimes(2);
  });

  it('rejects a repeated page when the API reports a different current page', async () => {
    const { result } = capture({ alias: 'records', path: '/records', rowsPath: 'rows',
      pagination: { ...pagination, currentPagePath: 'page' } },
    () => ({ rows: [{ id: 'first' }], pages: 2, page: 1 }));
    await expect(result).rejects.toThrow('report_http_page_mismatch:records:2');
  });

  it('rejects a nonempty response claiming zero total pages', async () => {
    const { result } = capture({ alias: 'records', path: '/records', rowsPath: 'rows', pagination },
      () => ({ rows: [{ id: 'first' }], pages: 0 }));
    await expect(result).rejects.toThrow('report_http_total_pages_inconsistent:records:1');
  });

  it('accepts an empty collection with zero pages', async () => {
    const { result, executeHttp } = capture({ alias: 'records', path: '/records', rowsPath: 'rows', pagination },
      () => ({ rows: [], pages: 0 }));
    expect((await result).records.rows).toEqual([]);
    expect(executeHttp).toHaveBeenCalledTimes(1);
  });

  it('rejects overlapping query controls before requesting the source', async () => {
    const { result, executeHttp } = capture({ alias: 'records', path: '/records', rowsPath: 'rows',
      pagination: { ...pagination, sizeParam: 'page' } }, () => ({ rows: [{ id: 'second' }], pages: 2 }));
    await expect(result).rejects.toThrow('report_http_query_params_conflict');
    expect(executeHttp).not.toHaveBeenCalled();
  });
});
