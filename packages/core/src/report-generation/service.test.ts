import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { buildTableArtifact } from '../contracts/artifacts/table-build.js';
import { buildHttpResponseArtifact } from '../contracts/artifacts/http-response.js';
import type { PdfReportPairAnalysis } from '../document-engine/types/pdf.js';
import type { Connector, ConnectorContext } from '../modules/types.js';
import { ReportGenerationService } from './service.js';
import { ReportCheckpointStore } from './checkpoints.js';

describe('ReportGenerationService', () => {
  it.each(['vision_unavailable', 'image_format_unsupported', 'image_input_empty', 'model_output_invalid', 'agent_timeout', 'agent_aborted', 'private-secret'])('normalizes provider error %s safely', async (code) => {
    const log = vi.fn();
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({
        source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` },
      }) },
      documentEngine: {
        pdfReportAnalyze: async () => { throw Object.assign(new Error('Provider failed with private details'), { code }); },
        pdfFormFill: vi.fn(),
      },
      planner: { inferCapturePlan: vi.fn(), inferReportPlan: vi.fn() },
      getConnector: () => undefined,
    });
    const result = await service.generate({ goal: 'create report', templateSourceId: 't', exampleSourceId: 'e' }, {
      workspaceSessionId: 'session', artifactSink: { write: vi.fn() }, log,
    } as unknown as ConnectorContext);
    expect(result).toMatchObject({ ok: false, errorCode: code === 'private-secret' ? 'report_generation_failed' : code });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ level: 'error', data: { phase: 'pair_analysis' } }));
  });

  it('logs bounded validation paths while keeping rejected model values out of the log', async () => {
    const log = vi.fn();
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({
        source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` },
      }) },
      documentEngine: {
        pdfReportAnalyze: async () => {
          throw Object.assign(new Error('model_output_invalid'), {
            code: 'model_output_invalid',
            issues: [{ code: 'too_small', path: ['reportPlan', 'scalars', 0, 'format', 'currency'], input: 'secret-value' }],
          });
        },
        pdfFormFill: vi.fn(),
      },
      planner: { inferCapturePlan: vi.fn(), inferReportPlan: vi.fn() },
      getConnector: () => undefined,
    });
    await service.generate({ goal: 'create report', templateSourceId: 't', exampleSourceId: 'e' }, {
      workspaceSessionId: 'session', artifactSink: { write: vi.fn() }, log,
    } as unknown as ConnectorContext);
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      code: 'model_output_invalid',
      data: { phase: 'pair_analysis', validationIssues: [{ code: 'too_small', path: ['reportPlan', 'scalars', 0, 'format', 'currency'] }] },
    }));
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-value');
  });
  it('derives reusable source and next-period metadata without exposing source rows', async () => {
    const { reportExecutionMetadata } = await import('./period-metadata.js');
    const metadata = reportExecutionMetadata(
      { start: '2032-11-01', endInclusive: '2032-11-30', label: 'November 2032' },
      {
        schemaVersion: 1,
        http: [{ alias: 'ledger', connectionId: 'private-id', path: '/records/v4', rowsPath: 'items' }],
        rdb: [{ alias: 'accounts', table: 'warehouse.account_directory' }],
      },
      'target',
    );

    expect(metadata).toMatchObject({
      periodEndExclusive: '2032-12-01',
      reportDate: '2032-12-01',
      'source.ledger.path': '/records/v4',
      'source.accounts.table': 'warehouse.account_directory',
      'source.accounts.tableName': 'account_directory',
      reportPhase: 'target',
    });
    expect(JSON.stringify(metadata)).not.toContain('private-id');
    expect(JSON.stringify(metadata)).not.toContain('items');
  });

  it('probes HTTP structure and refines the capture contract before reading report rows', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-http-refine-'));
    const templatePath = join(root, 'template.pdf');
    const examplePath = join(root, 'example.pdf');
    writeFileSync(templatePath, 'template');
    writeFileSync(examplePath, 'example');
    const pair: PdfReportPairAnalysis = {
      schemaVersion: 1, pairId: 'pair', templateHash: 'template-hash', exampleHash: 'example-hash', pageCount: 1,
      pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
      scalarSlots: [{
        id: 'count', pageIndex: 0, rect: { x: 10, y: 10, width: 20, height: 10 },
        exampleText: '2', fontSize: 10, font: 'Fixture', color: 0,
      }],
      tableGroups: [], templateImages: [], exampleImages: [],
    };
    const requests: Array<Record<string, unknown>> = [];
    const http: Connector = {
      name: 'http',
      execute: vi.fn(async (_action, params) => {
        requests.push(params);
        const path = String(params.path);
        return {
          ok: true,
          data: buildHttpResponseArtifact({
            executionId: 'http-read', url: `http://example.test${path}`, status: 200, statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ data: [{ id: 'o1' }, { id: 'o2' }], meta: { page: 1, total_pages: 1 } }),
          }),
        };
      }),
    };
    const refineCapturePlan = vi.fn(async ({ provisional }: { provisional: Record<string, unknown> }) => ({
      ...(provisional as object),
      capturePlan: {
        schemaVersion: 1,
        http: [{
          alias: 'orders', connectionId: 'orders-api', path: '/records', rowsPath: 'data',
          dateQuery: { fromParam: 'from', toParam: 'to' },
          pagination: { pageParam: 'page', sizeParam: 'size', pageSize: 100, totalPagesPath: 'meta.total_pages', maxPages: 10 },
        }],
        rdb: [],
      },
    }));
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({
        source: { id, fileName: `${id}.pdf` },
        artifact: { storedPath: id === 'template' ? templatePath : examplePath },
      }) },
      documentEngine: {
        pdfReportAnalyze: async () => pair,
        pdfFormFill: async (path, options) => {
          writeFileSync(options.outputPath!, `generated from ${path}`);
          return {
            sourcePath: path, outputPath: options.outputPath!, sourceHash: 'template-hash', outputHash: 'out',
            pageCount: 1, fieldCount: 1, writerEngine: 'pymupdf' as const, verified: true,
            interactive: false, sourceUnchanged: true,
          };
        },
      },
      planner: {
        inferCapturePlan: async () => ({
          schemaVersion: 1,
          examplePeriod: { start: '2031-03-01', endInclusive: '2031-03-31', label: '2031-03' },
          targetPeriod: { start: '2031-04-01', endInclusive: '2031-04-30', label: '2031-04' },
          capturePlan: { schemaVersion: 1, http: [{ alias: 'orders', connectionId: 'orders-api', path: '/records', rowsPath: 'items' }], rdb: [] },
        }),
        refineCapturePlan,
        inferReportPlan: async () => ({
          schemaVersion: 1,
          reportPlan: { schemaVersion: 1, baseSource: 'orders', joins: [], scalars: [{ id: 'count', expression: { kind: 'count' } }], tables: [], texts: [] },
          layout: { schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [{ slotId: 'count', value: { kind: 'scalar', id: 'count' } }], tableBindings: [] },
        }),
      },
      getConnector: (name) => name === 'http' ? http : undefined,
      makeTemporaryDirectory: () => join(root, 'output'),
    });

    const response = await service.generate({ goal: 'next report', templateSourceId: 'template', exampleSourceId: 'example' }, {
      executionId: 'exec', workspaceSessionId: 'chat', variables: {},
      connections: [{ connector: 'http', connected: true, config: { endpoints: [{ id: 'orders-api', baseUrl: 'http://example.test' }] } }],
      artifactSink: { putBytes: vi.fn((bytes, options) => ({ id: 'artifact', sha256: 'sha', fileName: options.fileName, mimeType: options.mimeType, size: bytes.length, createdAt: '2031-04-01T00:00:00Z' })) },
      log: vi.fn(),
    });

    expect(response.ok).toBe(true);
    expect(refineCapturePlan).toHaveBeenCalledTimes(1);
    expect(requests[0]).toEqual({ connectionId: 'orders-api', method: 'GET', path: '/records' });
    expect(requests.slice(1).map((request) => String(request.path))).toEqual([
      '/records?from=2031-03-01&to=2031-03-31&page=1&size=100',
      '/records?from=2031-04-01&to=2031-04-30&page=1&size=100',
    ]);
  });

  it.each([false, true])('replays before PDF storage, explicit resume=%s', async (resume) => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-service-'));
    const templatePath = join(root, 'template.pdf');
    const examplePath = join(root, 'example.pdf');
    writeFileSync(templatePath, 'template');
    writeFileSync(examplePath, 'example');
    const pair: PdfReportPairAnalysis = {
      schemaVersion: 1,
      pairId: 'pair', templateHash: 'template-hash', exampleHash: 'example-hash', pageCount: 1,
      pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
      scalarSlots: [{
        id: 'count', pageIndex: 0, rect: { x: 10, y: 10, width: 20, height: 10 },
        exampleText: '1', fontSize: 10, font: 'Fixture', color: 0,
      }],
      tableGroups: [], templateImages: [], exampleImages: [],
    };
    const documentEngine = {
      pdfReportAnalyze: vi.fn(async () => pair),
      pdfFormFill: vi.fn(async (path: string, options: { outputPath?: string }) => {
        writeFileSync(options.outputPath!, `generated from ${path}`);
        return {
          sourcePath: path, outputPath: options.outputPath!, sourceHash: 'template-hash', outputHash: 'output-hash',
          pageCount: 1, fieldCount: 1, writerEngine: 'pymupdf' as const, verified: true,
          interactive: false, sourceUnchanged: true,
        };
      }),
    };
    const rdb: Connector = {
      name: 'rdb',
      execute: vi.fn(async (action) => action === 'schema.describe'
        ? { ok: true, data: ['public.orders'] }
        : { ok: true, data: buildTableArtifact({
          id: 'orders', headers: ['id'], matrix: [[1]], source: { table: 'orders' },
        }) }),
    };
    const putBytes = vi.fn((bytes: Uint8Array, options: { fileName: string; mimeType?: string }) => ({
      id: 'generated-report', sha256: 'sha', fileName: options.fileName, mimeType: options.mimeType,
      size: bytes.length, createdAt: '2026-09-04T00:00:00.000Z',
    }));
    const logs: unknown[] = [];
    const ctx: ConnectorContext = {
      executionId: 'exec-1', workspaceSessionId: 'chat-1', variables: {},
      connections: [], artifactSink: { putBytes }, log: (entry) => logs.push(entry),
    };
    let failPlanning = resume;
    const service = new ReportGenerationService({
      checkpoints: new ReportCheckpointStore(join(root, 'checkpoints')),
      workspaceSources: {
        resolveStoredFile: (_sessionId, sourceId) => ({
          source: { id: sourceId, fileName: sourceId === 'template-source' ? 'template.pdf' : 'example.pdf' },
          artifact: { storedPath: sourceId === 'template-source' ? templatePath : examplePath },
        }),
      },
      documentEngine,
      planner: {
        inferCapturePlan: async () => ({
          schemaVersion: 1,
          examplePeriod: { start: '2026-08-01', endInclusive: '2026-08-31', label: '2026년 8월' },
          targetPeriod: { start: '2026-09-01', endInclusive: '2026-09-30', label: '2026년 9월' },
          capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'orders', table: 'public.orders' }] },
        }),
        inferReportPlan: async () => {
          if (failPlanning) {
            failPlanning = false;
            throw Object.assign(new Error('Planning exceeded budget'), { code: 'agent_timeout' });
          }
          return ({
          schemaVersion: 1,
          reportPlan: {
            schemaVersion: 1, baseSource: 'orders', joins: [],
            scalars: [{ id: 'count', expression: { kind: 'count' }, format: { style: 'integer' } }],
            tables: [], texts: [],
          },
          layout: {
            schemaVersion: 1, outputFileName: '2026-09-report.pdf',
            scalarBindings: [{ slotId: 'count', value: { kind: 'scalar', id: 'count' } }], tableBindings: [],
          },
          });
        },
      },
      getConnector: (name) => name === 'rdb' ? rdb : undefined,
      makeTemporaryDirectory: () => join(root, 'output'),
    });

    const params = {
      goal: '다음 달 보고서를 같은 기준과 형식으로 만들어줘',
      templateSourceId: 'template-source',
      exampleSourceId: 'example-source',
    };
    if (resume) {
      const failed = await service.generate(params, ctx);
      expect(failed).toMatchObject({ ok: false, errorCode: 'agent_timeout' });
      expect(putBytes).not.toHaveBeenCalled();
      const changed = await service.generate({ ...params, goal: 'different', resumeExecutionId: 'exec-1' }, { ...ctx, executionId: 'changed' });
      expect(changed.errorCode).toBe('report_checkpoint_input_changed');
    }
    const response = await service.generate({ ...params, ...(resume ? { resumeExecutionId: 'exec-1' } : {}) },
      { ...ctx, executionId: resume ? 'exec-2' : 'exec-1' });

    expect(response.ok).toBe(true);
    expect(documentEngine.pdfReportAnalyze).toHaveBeenCalledTimes(1);
    expect(vi.mocked(rdb.execute).mock.calls.filter(([action]) => action === 'query.read')).toHaveLength(2);
    if (resume) expect(logs).toContainEqual(expect.objectContaining({ code: 'report_stage_resumed', data: { phase: 'example_capture' } }));
    expect(documentEngine.pdfFormFill).toHaveBeenCalledTimes(1);
    expect(putBytes).toHaveBeenCalledWith(
      readFileSync(join(root, 'output', '2026-09-report.pdf')),
      { fileName: '2026-09-report.pdf', mimeType: 'application/pdf' },
    );
    expect(logs).toContainEqual(expect.objectContaining({ code: 'report_example_replay_passed' }));
    expect(logs).toContainEqual(expect.objectContaining({ code: 'pdf_generated' }));
  });

  it('does not write a PDF when the example calculation fails replay', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-replay-fail-'));
    const templatePath = join(root, 'template.pdf');
    const examplePath = join(root, 'example.pdf');
    writeFileSync(templatePath, 'template');
    writeFileSync(examplePath, 'example');
    const fill = vi.fn();
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({
        source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: id.includes('template') ? templatePath : examplePath },
      }) },
      documentEngine: {
        pdfReportAnalyze: async () => ({
          schemaVersion: 1, pairId: 'p', templateHash: 'h', exampleHash: 'e', pageCount: 1,
          pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
          scalarSlots: [{ id: 'count', pageIndex: 0, rect: { x: 1, y: 1, width: 10, height: 10 }, exampleText: '99', fontSize: 10, font: 'f', color: 0 }],
          tableGroups: [], templateImages: [], exampleImages: [],
        }),
        pdfFormFill: fill,
      },
      planner: {
        inferCapturePlan: async () => ({
          schemaVersion: 1,
          examplePeriod: { start: '2026-08-01', endInclusive: '2026-08-31', label: '2026년 8월' },
          targetPeriod: { start: '2026-09-01', endInclusive: '2026-09-30', label: '2026년 9월' },
          capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'orders', table: 'public.orders' }] },
        }),
        inferReportPlan: async () => ({
          schemaVersion: 1,
          reportPlan: { schemaVersion: 1, baseSource: 'orders', joins: [], scalars: [{ id: 'count', expression: { kind: 'count' } }], tables: [], texts: [] },
          layout: { schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [{ slotId: 'count', value: { kind: 'scalar', id: 'count' } }], tableBindings: [] },
        }),
      },
      getConnector: () => ({ name: 'rdb', execute: async (action) => action === 'schema.describe'
        ? { ok: true, data: ['public.orders'] }
        : { ok: true, data: buildTableArtifact({ id: 'orders', headers: ['id'], matrix: [[1]] }) } }),
      makeTemporaryDirectory: () => join(root, 'output'),
    });
    const response = await service.generate({ goal: 'report', templateSourceId: 'template', exampleSourceId: 'example' }, {
      executionId: 'exec', workspaceSessionId: 'chat', variables: {}, connections: [],
      artifactSink: { putBytes: vi.fn() }, log: vi.fn(),
    });
    expect(response).toMatchObject({ ok: false, errorCode: 'report_example_replay_failed' });
    expect(fill).not.toHaveBeenCalled();
  });

  it('revises from example replay mismatches before any target result is rendered', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-revise-'));
    const templatePath = join(root, 'template.pdf');
    const examplePath = join(root, 'example.pdf');
    writeFileSync(templatePath, 'template');
    writeFileSync(examplePath, 'example');
    const events: string[] = [];
    const basePlan = {
      schemaVersion: 1 as const,
      baseSource: 'records',
      joins: [],
      scalars: [{ id: 'count', expression: { kind: 'count' as const } }],
      tables: [],
      texts: [],
    };
    const layout = {
      schemaVersion: 1 as const,
      outputFileName: 'report-{{meta.periodYear}}-{{meta.periodMonthPadded}}.pdf',
      scalarBindings: [{ slotId: 'count', value: { kind: 'scalar' as const, id: 'count' } }],
      tableBindings: [],
    };
    const reviseReportPlan = vi.fn(async function (this: { inferCapturePlan: unknown }, input: { replayFailure: { mismatches: unknown[] } }) {
      expect(this.inferCapturePlan).toBeTypeOf('function');
      events.push('revise');
      expect(input.replayFailure.mismatches).toEqual([{ slotId: 'count', expected: '2', actual: '0' }]);
      return { schemaVersion: 1 as const, reportPlan: basePlan, layout };
    });
    let readCount = 0;
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({
        source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: id === 'template' ? templatePath : examplePath },
      }) },
      documentEngine: {
        pdfReportAnalyze: async () => ({
          schemaVersion: 1, pairId: 'pair', templateHash: 'hash', exampleHash: 'example-hash', pageCount: 1,
          pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
          scalarSlots: [{ id: 'count', pageIndex: 0, rect: { x: 1, y: 1, width: 10, height: 10 }, exampleText: '2', fontSize: 10, font: 'f', color: 0 }],
          tableGroups: [], templateImages: [], exampleImages: [],
        }),
        pdfFormFill: async (path, options) => {
          events.push('render-target');
          writeFileSync(options.outputPath!, 'pdf');
          return {
            sourcePath: path, outputPath: options.outputPath!, sourceHash: 'hash', outputHash: 'out',
            pageCount: 1, fieldCount: 1, writerEngine: 'pymupdf' as const, verified: true,
            interactive: false, sourceUnchanged: true,
          };
        },
      },
      planner: {
        inferCapturePlan: async () => ({
          schemaVersion: 1,
          examplePeriod: { start: '2035-01-01', endInclusive: '2035-01-31', label: 'example' },
          targetPeriod: { start: '2035-02-01', endInclusive: '2035-02-28', label: 'target' },
          capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'records', table: 'allowed.records' }] },
        }),
        inferReportPlan: async () => ({
          schemaVersion: 1,
          reportPlan: {
            ...basePlan,
            scalars: [{
              id: 'count',
              expression: {
                kind: 'count' as const,
                where: {
                  kind: 'compare' as const,
                  operation: 'eq' as const,
                  left: { kind: 'field' as const, path: 'records.id' },
                  right: { kind: 'literal' as const, value: 'not-present' },
                },
              },
            }],
          },
          layout,
        }),
        reviseReportPlan,
      },
      getConnector: () => ({
        name: 'rdb',
        execute: async (action) => {
          if (action === 'schema.describe') return { ok: true, data: ['allowed.records'] };
          readCount += 1;
          events.push(`read-${readCount}`);
          return { ok: true, data: buildTableArtifact({ id: 'records', headers: ['id'], matrix: [['a'], ['b']] }) };
        },
      }),
      makeTemporaryDirectory: () => join(root, 'output'),
    });

    const response = await service.generate({ goal: 'next report', templateSourceId: 'template', exampleSourceId: 'example' }, {
      executionId: 'exec', workspaceSessionId: 'chat', variables: {}, connections: [],
      artifactSink: { putBytes: (bytes, options) => ({ id: 'artifact', sha256: 'sha', fileName: options.fileName, mimeType: options.mimeType, size: bytes.length, createdAt: '2035-02-01' }) },
      log: vi.fn(),
    });

    expect(response.ok).toBe(true);
    expect(reviseReportPlan).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['read-1', 'revise', 'read-2', 'render-target']);
  });
});
