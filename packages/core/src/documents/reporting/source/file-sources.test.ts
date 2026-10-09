import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import { captureReportSources } from './capture.js';
import { inspectReportCatalog } from '../planner/catalog.js';
import { validateCapturePlan } from '../planner/plan-validation.js';
import { listReportFiles } from '../service/file-sources.js';
import type { ReportCaptureInference } from '../planner/schema.js';
import type { ConnectorContext } from '../../../connectors/types.js';

const august = { start: '2026-08-01', endInclusive: '2026-08-31', label: '2026년 8월' };
const september = { start: '2026-09-01', endInclusive: '2026-09-30', label: '2026년 9월' };
const plan = { schemaVersion: 1 as const, http: [], rdb: [],
  file: [{ alias: 'sales', folderId: 'reports', path: '매출/매출_2026-08.xlsx', perPeriod: true }] };

function sheet(rows: Array<[string, number]>) {
  return buildTableArtifact({ id: 'sheet', headers: ['상품', '금액'], matrix: rows });
}

describe('a report reading a sheet in a connected folder', () => {
  it('reads the example period\'s file, then the file named for the target period', async () => {
    const executeFile = vi.fn(async ({ path }: { path: string }) => ({
      ok: true, data: sheet(path.includes('2026-08') ? [['A', 100]] : [['A', 120], ['B', 30]]),
    }));
    const gateway = { executeHttp: vi.fn(), executeRdb: vi.fn(), executeFile };

    const example = await captureReportSources(plan, august, gateway, {}, august);
    const target = await captureReportSources(plan, september, gateway, {}, august);

    expect(executeFile.mock.calls.map(([request]) => request.path)).toEqual(['매출/매출_2026-08.xlsx', '매출/매출_2026-09.xlsx']);
    expect(example.sales!.rows).toEqual([{ 상품: 'A', 금액: 100 }]);
    expect(target.sales!.rows).toHaveLength(2);
    expect(target.sales!.provenance?.source).toBe('매출/매출_2026-09.xlsx');
  });

  it('stops, naming the file, when this period\'s file is not in the folder yet', async () => {
    const gateway = { executeHttp: vi.fn(), executeRdb: vi.fn(),
      executeFile: vi.fn(async () => ({ ok: false, error: 'file_not_accessible', errorCode: 'file_not_accessible' })) };
    await expect(captureReportSources(plan, september, gateway, {}, august))
      .rejects.toThrow('report_file_period_missing:sales:매출_2026-09.xlsx');
  });

  it('lists files in the catalog by folder and finds them by name', () => {
    const files = [{ folderId: 'reports', folderLabel: '월간 보고', path: '매출/매출_2026-08.xlsx', modifiedAt: '2026-09-01T00:00:00Z' }];
    const page = inspectReportCatalog([], ['orders'], { kind: 'catalog', connector: 'file', query: '매출' }, files);
    expect(page).toMatchObject({ total: 1, entries: [{ kind: 'file', folderId: 'reports', path: '매출/매출_2026-08.xlsx' }] });
    expect(inspectReportCatalog([], ['orders'], { kind: 'catalog', connector: 'rdb' }, files)).toMatchObject({ total: 1, entries: [{ kind: 'rdb_table' }] });
  });

  it('accepts only listed files, and a file per period only when its name shows the period', () => {
    const inference: ReportCaptureInference = { schemaVersion: 1, examplePeriod: august, targetPeriod: september, capturePlan: plan };
    const files = [{ folderId: 'reports', folderLabel: '월간 보고', path: '매출/매출_2026-08.xlsx' }];
    expect(validateCapturePlan(inference, [], [], files).capturePlan.file).toHaveLength(1);
    expect(() => validateCapturePlan(inference, [], [], [])).toThrow('report_file_unknown:sales');
    const unnamed = { ...inference, capturePlan: { ...plan, file: [{ ...plan.file[0]!, path: '매출.xlsx' }] } };
    expect(() => validateCapturePlan(unnamed, [], [], [{ ...files[0]!, path: '매출.xlsx' }])).toThrow('report_file_period_name_unknown');
  });

  it('refuses a path that leaves the folder', () => {
    const escaping = { schemaVersion: 1 as const, examplePeriod: august, targetPeriod: september,
      capturePlan: { ...plan, file: [{ alias: 'x', folderId: 'reports', path: '../secret.xlsx' }] } };
    expect(() => validateCapturePlan(escaping, [], [], [{ folderId: 'reports', folderLabel: 'r', path: '../secret.xlsx' }])).toThrow();
  });

  it('lists the sheets of connected folders relative to each folder, skipping Office lock files', async () => {
    const root = resolve('reports-root');
    const execute = vi.fn(async () => ({ ok: true, data: { files: [
      { filePath: join(root, '매출', '매출_2026-08.xlsx'), modifiedAt: '2026-09-01T00:00:00Z' },
      { filePath: join(root, '~$매출_2026-08.xlsx') },
    ] } }));
    const ctx = { connections: [{ connector: 'local_folder', connected: true,
      config: { folders: [{ id: 'reports', label: '월간 보고', path: root, addedAt: '2026-01-01T00:00:00Z' }] } }] } as unknown as ConnectorContext;
    const files = await listReportFiles(ctx, { name: 'local_folder', execute });
    expect(files).toEqual([{ folderId: 'reports', folderLabel: '월간 보고', path: '매출/매출_2026-08.xlsx', modifiedAt: '2026-09-01T00:00:00Z' }]);
    expect(execute).toHaveBeenCalledWith('list', { folderId: 'reports', extensions: ['.csv', '.xlsx', '.xls'] }, ctx);
  });
});
