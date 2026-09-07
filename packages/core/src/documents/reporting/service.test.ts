import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import { buildHttpResponseArtifact } from '../../contracts/artifacts/http-response.js';
import type { PdfReportPairAnalysis } from '../read/types/pdf.js';
import type { Connector, ConnectorContext } from '../../connectors/types.js';
import { ReportGenerationService } from './service.js';
import { ReportCheckpointStore } from './checkpoints.js';
import { ReportSourceReplanRequired, type ReportSourceNeed, type ReportCaptureInference } from './planner/schema.js';
import { ReportPlanner } from './planner/planner.js';

describe('ReportGenerationService', () => {
  it.each(['allowed', 'denied'])('routes real planner metadata requests through host policy: %s', async mode => {
    let calls = 0;
    const seen: string[] = [];
    const planner = new ReportPlanner({ providerName: 'fixture', async run(request) {
      seen.push(request.context.untrustedData ?? '');
      if (request.logContext === 'report-source-requirements') {
        return { output: request.outputSchema.parse({ schemaVersion: 1, requirements: [] }) };
      }
      calls++;
      return { output: request.outputSchema.parse(calls === 1
        ? { schemaVersion: 1, status: 'need_evidence', request: { kind: 'rdb_table', table: mode === 'allowed' ? 'measurements' : 'secret' } }
        : { schemaVersion: 1, status: 'needs_input', reason: 'The metric definition is ambiguous' }) };
    } });
    const execute = vi.fn(async (action: string) => action === 'schema.describe'
      ? { ok: true, data: ['measurements'] }
      : { ok: true, data: { table: 'measurements', columns: [{ name: 'amount', type: 'numeric' }] } });
    const fill = vi.fn();
    const sink = vi.fn();
    const service = new ReportGenerationService({ planner,
      workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
      documentEngine: { pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1,
        pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }), pdfFormFill: fill },
      getConnector: name => name === 'rdb' ? { name: 'rdb', execute } : undefined,
    });
    const result = await service.generate({ goal: 'Create a report', templateSourceId: 't', exampleSourceId: 'e' }, {
      workspaceSessionId: 'session', artifactSink: { putBytes: sink }, log: vi.fn(),
    } as unknown as ConnectorContext);
    expect(result).toMatchObject({ ok: false, errorCode: mode === 'allowed'
      ? 'report_source_discovery_needs_input' : 'report_source_inspection_denied' });
    expect(execute.mock.calls.map(call => call[0])).toEqual(mode === 'allowed'
      ? ['schema.describe', 'table.describe'] : ['schema.describe']);
    expect(seen.some(value => value.includes('numeric'))).toBe(mode === 'allowed');
    expect(fill).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });
  it.each([
    ['same', 'report_source_replan_no_progress'],
    ['unknown', 'report_http_connection_unknown'],
    ['period', 'report_source_replan_period_changed'],
    ['removed', 'report_source_replan_selection_changed'],
    ['limit', 'report_source_replan_limit'],
    ['ambiguous', 'report_evidence_ambiguous_rule'],
  ])('fails closed on %s without target capture or PDF delivery', async (mode, expectedCode) => {
    const need: ReportSourceNeed = { id: 'required', connector: 'http', description: 'Event history', reason: 'Explicit user source' };
    const fill = vi.fn();
    const sink = vi.fn();
    const query = vi.fn(async (action: string) => action === 'schema.describe'
      ? { ok: true, data: ['dimension0', 'dimension1', 'dimension2'] }
      : { ok: true, data: buildTableArtifact({ id: 'dimension', headers: ['id'], matrix: [[1]] }) });
    let attempts = 0;
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
      documentEngine: { pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1,
        pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }), pdfFormFill: fill },
      planner: {
        inferSourceRequirements: async () => mode === 'ambiguous' ? [] : [need],
        inferCapturePlan: async () => {
          attempts++;
          return { schemaVersion: 1,
            examplePeriod: { start: '2037-05-01', endInclusive: '2037-05-31', label: mode === 'period' && attempts > 1 ? 'changed' : 'example' },
            targetPeriod: { start: '2037-06-01', endInclusive: '2037-06-30', label: 'target' },
            capturePlan: { schemaVersion: 1,
              http: mode === 'unknown' && attempts > 1 ? [{ alias: 'events', connectionId: 'not-authorized', path: '/events', rowsPath: '$' }] : [],
              rdb: mode === 'removed' && attempts > 1 ? [] : Array.from({ length: mode === 'limit' ? attempts : 1 }, (_, index) => ({ alias: `d${index}`, table: `dimension${index}` })) },
          };
        },
        inferReportPlan: async () => { throw new Error('report_evidence_ambiguous_rule'); },
      },
      getConnector: name => name === 'rdb' ? { name: 'rdb', execute: query } : undefined,
    });
    const result = await service.generate({ goal: 'Create the next service report', templateSourceId: 't', exampleSourceId: 'e' }, {
      workspaceSessionId: 'session', connections: [{ connector: 'http', connected: true, config: { endpoints: [{ id: 'allowed', baseUrl: 'https://service.test' }] } }],
      artifactSink: { putBytes: sink }, log: vi.fn(),
    } as unknown as ConnectorContext);
    expect(result).toMatchObject({ ok: false, errorCode: expectedCode });
    expect(attempts).toBe(mode === 'ambiguous' ? 1 : mode === 'limit' ? 3 : 2);
    expect(query.mock.calls.filter(call => call[0] === 'query.read')).toHaveLength(mode === 'ambiguous' ? 1 : 0);
    expect(fill).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
  });
  it('allows an authorized HTTP source replacement when the logical alias is preserved', async () => {
    const need: ReportSourceNeed = { id: 'required', connector: 'http', description: 'Event history', reason: 'Explicit user source' };
    let attempts = 0;
    const http: Connector = {
      name: 'http',
      execute: vi.fn(async (_action, params) => ({ ok: true, data: buildHttpResponseArtifact({
        executionId: 'inspection', url: `https://events.test${String(params.path)}`,
        status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '[]',
      }) })),
    };
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
      documentEngine: { pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1,
        pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }), pdfFormFill: vi.fn() },
      planner: {
        inferSourceRequirements: async () => [need],
        inferCapturePlan: async () => {
          attempts++;
          const source = attempts === 1
            ? { alias: 'events', connectionId: 'first', path: '/events', rowsPath: '$' }
            : { alias: 'events', connectionId: 'second', path: '/events', rowsPath: '$' };
          return {
            schemaVersion: 1 as const,
            examplePeriod: { start: '2037-05-01', endInclusive: '2037-05-31', label: 'example' },
            targetPeriod: { start: '2037-06-01', endInclusive: '2037-06-30', label: 'target' },
            capturePlan: { schemaVersion: 1 as const, http: [source], rdb: [] },
            ...(attempts > 1 ? { requirementBindings: [{ requirementId: 'required', aliases: ['events'] }] } : {}),
          };
        },
        refineCapturePlan: async ({ provisional }) => provisional,
        inferReportPlan: async () => { throw new Error('report_evidence_ambiguous_rule'); },
      },
      getConnector: name => name === 'http' ? http : undefined,
    });
    const result = await service.generate({ goal: 'Create the next event report from /events', templateSourceId: 't', exampleSourceId: 'e' }, {
      workspaceSessionId: 'session', connections: [{ connector: 'http', connected: true, config: { endpoints: [
        { id: 'first', baseUrl: 'https://events.test' }, { id: 'second', baseUrl: 'https://events.test', path: '/v2' },
      ] } }],
      artifactSink: { putBytes: vi.fn() }, log: vi.fn(),
    } as unknown as ConnectorContext);
    expect(result).toMatchObject({ ok: false, errorCode: 'report_evidence_ambiguous_rule' });
    expect(attempts).toBe(2);
  });
  it('preserves server identity in the source catalog without leaking URL credentials or queries', async () => {
    const inferCapturePlan = vi.fn(async () => { throw new Error('stop_after_catalog'); });
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
      documentEngine: { pdfReportAnalyze: async () => ({ templateImages: [], exampleImages: [], scalarSlots: [], tableGroups: [] }) as unknown as PdfReportPairAnalysis, pdfFormFill: vi.fn() },
      planner: { inferSourceRequirements: async () => [], inferCapturePlan, inferReportPlan: vi.fn() }, getConnector: () => undefined,
    });
    await service.generate({ goal: 'monthly report', templateSourceId: 't', exampleSourceId: 'e' }, {
      workspaceSessionId: 'chat', artifactSink: { putBytes: vi.fn() }, log: vi.fn(),
      connections: [{ connector: 'http', connected: true, config: { endpoints: [
        { id: 'default', label: 'Service', baseUrl: 'https://code.example/' },
        { id: 'other', label: 'Service', baseUrl: 'https://user:private-password@ledger.example:8443/v2/?token=private-query#private-fragment' },
      ] } }],
    } as unknown as ConnectorContext);
    expect(inferCapturePlan).toHaveBeenCalledWith(expect.objectContaining({ httpConnections: [
      { id: 'default', label: 'Service', origin: 'https://code.example', basePath: '/' },
      { id: 'other', label: 'Service', origin: 'https://ledger.example:8443', basePath: '/v2/' },
    ] }));
    expect(JSON.stringify(inferCapturePlan.mock.calls)).not.toContain('private-');
  });
  it('executes the route requested for HTTP source inspection instead of substituting the root path', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const http: Connector = {
      name: 'http',
      execute: vi.fn(async (_action, params) => {
        requests.push(params);
        return { ok: true, data: buildHttpResponseArtifact({
          executionId: 'inspection', url: `http://orders.test${String(params.path)}`,
          status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '[]',
        }) };
      }),
    };
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({
        source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` },
      }) },
      documentEngine: {
        pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
          pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }),
        pdfFormFill: vi.fn(),
      },
      planner: {
        inferSourceRequirements: async () => [],
        inferCapturePlan: async ({ inspectSource }) => {
          await inspectSource!({ kind: 'http_connection', connectionId: 'orders', path: '/api/v1/orders' } as never);
          throw new Error('stop_after_inspection');
        },
        inferReportPlan: vi.fn(),
      },
      getConnector: name => name === 'http' ? http : undefined,
    });
    await service.generate({ goal: 'inspect /api/v1/orders', templateSourceId: 'template', exampleSourceId: 'example' }, {
      workspaceSessionId: 'session', connections: [{ connector: 'http', connected: true,
        config: { endpoints: [{ id: 'orders', baseUrl: 'http://orders.test' }] } }],
      artifactSink: { putBytes: vi.fn() }, log: vi.fn(),
    } as unknown as ConnectorContext);
    expect(requests).toEqual([{ connectionId: 'orders', method: 'GET', path: '/api/v1/orders' }]);
  });
  it('does not probe an HTTP route that is absent from the report evidence', async () => {
    const execute = vi.fn();
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({
        source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` },
      }) },
      documentEngine: {
        pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
          pageCount: 1, pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] }),
        pdfFormFill: vi.fn(),
      },
      planner: {
        inferSourceRequirements: async () => [],
        inferCapturePlan: async ({ inspectSource }) => {
          const result = await inspectSource!({ kind: 'http_connection', connectionId: 'orders', path: '/invented' } as never);
          expect(result).toEqual({ available: false, connectionId: 'orders', path: '/invented',
            reason: 'http_path_not_in_report_evidence' });
          throw new Error('stop_after_inspection');
        },
        inferReportPlan: vi.fn(),
      },
      getConnector: name => name === 'http' ? { name: 'http', execute } : undefined,
    });
    await service.generate({ goal: 'inspect orders', templateSourceId: 'template', exampleSourceId: 'example' }, {
      workspaceSessionId: 'session', connections: [{ connector: 'http', connected: true,
        config: { endpoints: [{ id: 'orders', baseUrl: 'http://orders.test' }] } }],
      artifactSink: { putBytes: vi.fn() }, log: vi.fn(),
    } as unknown as ConnectorContext);
    expect(execute).not.toHaveBeenCalled();
  });

  it('carries a rejected static-query recovery into refinement and both period captures', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-query-recovery-'));
    const templatePath = join(root, 'template.pdf');
    const examplePath = join(root, 'example.pdf');
    writeFileSync(templatePath, 'template');
    writeFileSync(examplePath, 'example');
    const pair: PdfReportPairAnalysis = {
      schemaVersion: 1, pairId: 'pair', templateHash: 'template', exampleHash: 'example', pageCount: 1,
      pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
      scalarSlots: [{ id: 'count', pageIndex: 0, rect: { x: 1, y: 1, width: 20, height: 10 },
        exampleText: '0', fontSize: 10, font: 'fixture', color: 0 }],
      tableGroups: [], templateImages: [], exampleImages: [],
    };
    const requests: string[] = [];
    const logs: unknown[] = [];
    const http: Connector = { name: 'http', execute: vi.fn(async (_action, params) => {
      const path = String(params.path);
      requests.push(path);
      if (path.includes('status=all')) return { ok: false, error: 'http_400', errorCode: 'http_error' };
      return { ok: true, data: buildHttpResponseArtifact({
        executionId: `response-${requests.length}`, url: `http://example.test${path}`, status: 200,
        statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '[]', truncated: false,
      }) };
    }) };
    const refineCapturePlan = vi.fn(async (input: { provisional: ReportCaptureInference }) => input.provisional);
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` },
        artifact: { storedPath: id === 'template' ? templatePath : examplePath } }) },
      documentEngine: {
        pdfReportAnalyze: async () => pair,
        pdfFormFill: async (sourcePath, options) => {
          writeFileSync(options.outputPath!, 'pdf');
          return { sourcePath, outputPath: options.outputPath!, sourceHash: 'template', outputHash: 'output',
            pageCount: 1, fieldCount: 1, writerEngine: 'pymupdf' as const, verified: true,
            interactive: false, sourceUnchanged: true };
        },
      },
      planner: {
        inferSourceRequirements: async () => [],
        inferCapturePlan: async () => ({ schemaVersion: 1 as const,
          examplePeriod: { start: '2031-03-01', endInclusive: '2031-03-31', label: 'example' },
          targetPeriod: { start: '2031-04-01', endInclusive: '2031-04-30', label: 'target' },
          capturePlan: { schemaVersion: 1 as const, http: [{ alias: 'orders', connectionId: 'allowed',
            path: '/records', rowsPath: '$', staticQuery: { status: 'all' } }], rdb: [] } }),
        refineCapturePlan,
        inferReportPlan: async () => ({ schemaVersion: 1 as const,
          reportPlan: { schemaVersion: 1 as const, baseSource: 'orders', joins: [],
            scalars: [{ id: 'count', expression: { kind: 'count' as const } }], tables: [], texts: [] },
          layout: { schemaVersion: 1 as const, outputFileName: 'report.pdf',
            scalarBindings: [{ slotId: 'count', value: { kind: 'scalar' as const, id: 'count' } }], tableBindings: [] } }),
      },
      getConnector: name => name === 'http' ? http : undefined,
      makeTemporaryDirectory: () => join(root, 'output'),
    });
    const result = await service.generate({ goal: 'Create a report from /records', templateSourceId: 'template', exampleSourceId: 'example' }, {
      executionId: 'query-recovery', workspaceSessionId: 'session', variables: {},
      connections: [{ connector: 'http', connected: true, config: { endpoints: [{ id: 'allowed', baseUrl: 'http://example.test' }] } }],
      artifactSink: { putBytes: vi.fn(() => ({ id: 'artifact', sha256: 'sha', fileName: 'report.pdf', mimeType: 'application/pdf', size: 3, createdAt: '2031-04-01T00:00:00Z' })) },
      log: entry => logs.push(entry),
    });

    expect(result.ok).toBe(true);
    expect(requests).toEqual(['/records?status=all', '/records', '/records', '/records']);
    expect(refineCapturePlan).toHaveBeenCalledWith(expect.objectContaining({
      staticQueryCorrections: [{ alias: 'orders', status: 400, queryKeys: ['status'] }],
      provisional: expect.objectContaining({ capturePlan: expect.objectContaining({
        http: [expect.objectContaining({ alias: 'orders', path: '/records' })],
      }) }),
    }));
    expect(logs).toContainEqual(expect.objectContaining({ code: 'report_http_static_query_removed' }));
  });
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
      planner: { inferSourceRequirements: async () => [], inferCapturePlan: vi.fn(), inferReportPlan: vi.fn() },
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
      planner: { inferSourceRequirements: async () => [], inferCapturePlan: vi.fn(), inferReportPlan: vi.fn() },
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
      periodRange: '2032-11-01 ~ 2032-11-30',
      periodEndExclusive: '2032-12-01',
      reportDate: '2032-12-01',
      'source.ledger.path': '/records/v4',
      'source.http.ledger.path': '/records/v4',
      'source.accounts.table': 'warehouse.account_directory',
      'source.accounts.tableName': 'account_directory',
      'source.rdb.accounts.table': 'warehouse.account_directory',
      'source.rdb.accounts.tableName': 'account_directory',
      reportPhase: 'target',
    });
    expect(JSON.stringify(metadata)).not.toContain('private-id');
    expect(JSON.stringify(metadata)).not.toContain('items');
  });

  it.each(['direct', 'coverage', 'evidence'])('probes and replays before delivery, source recovery=%s', async (recovery) => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-http-refine-'));
    const checkpoints = new ReportCheckpointStore(join(root, 'checkpoints'));
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
    const need: ReportSourceNeed = { id: 'transactions', connector: 'http',
      description: 'Transaction history', reason: 'Required to calculate the report count' };
    let captureAttempts = 0;
    let businessAttempts = 0;
    const rdb = { name: 'rdb', execute: vi.fn(async (action: string) => action === 'schema.describe'
      ? { ok: true, data: ['directory'] }
      : { ok: true, data: buildTableArtifact({ id: 'directory', headers: ['id'], matrix: [['a']] }) }) };
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
        rdb: [{ alias: 'directory', table: 'directory' }],
      },
    }));
    const service = new ReportGenerationService({
      checkpoints,
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
        inferSourceRequirements: async () => recovery === 'evidence' ? [] : [need],
        inferCapturePlan: async ({ requirements }) => {
          captureAttempts++;
          const includeHttp = recovery === 'direct' || captureAttempts > 1;
          if (recovery === 'coverage' && captureAttempts === 2) {
            expect(rdb.execute.mock.calls.filter(call => call[0] === 'query.read')).toHaveLength(0);
            expect(requests).toHaveLength(0);
          }
          return {
          schemaVersion: 1,
          examplePeriod: { start: '2031-03-01', endInclusive: '2031-03-31', label: '2031-03' },
          targetPeriod: { start: '2031-04-01', endInclusive: '2031-04-30', label: '2031-04' },
          capturePlan: { schemaVersion: 1,
            http: includeHttp ? [{ alias: 'orders', connectionId: 'orders-api', path: '/records', rowsPath: 'items' }] : [],
            rdb: [{ alias: 'directory', table: 'directory' }] },
          requirementBindings: includeHttp ? requirements?.map(item => ({ requirementId: item.id, aliases: ['orders'] })) : [],
        }; },
        refineCapturePlan,
        inferReportPlan: async ({ exampleSources }) => {
          businessAttempts++;
          if (!exampleSources.orders) throw new ReportSourceReplanRequired([need]);
          return {
          schemaVersion: 1,
          reportPlan: { schemaVersion: 1, baseSource: 'orders', joins: [], scalars: [{ id: 'count', expression: { kind: 'count' } }], tables: [], texts: [] },
          layout: { schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [{ slotId: 'count', value: { kind: 'scalar', id: 'count' } }], tableBindings: [] },
        }; },
      },
      getConnector: (name) => name === 'http' ? http : name === 'rdb' ? rdb : undefined,
      makeTemporaryDirectory: () => join(root, 'output'),
    });

    const response = await service.generate({ goal: 'next report using /records', templateSourceId: 'template', exampleSourceId: 'example' }, {
      executionId: 'exec', workspaceSessionId: 'chat', variables: {},
      connections: [{ connector: 'http', connected: true, config: { endpoints: [{ id: 'orders-api', baseUrl: 'http://example.test' }] } }],
      artifactSink: { putBytes: vi.fn((bytes, options) => ({ id: 'artifact', sha256: 'sha', fileName: options.fileName, mimeType: options.mimeType, size: bytes.length, createdAt: '2031-04-01T00:00:00Z' })) },
      log: vi.fn(),
    });

    expect(response.ok, JSON.stringify(response)).toBe(true);
    expect(captureAttempts).toBe(recovery === 'direct' ? 1 : 2);
    expect(businessAttempts).toBe(recovery === 'evidence' ? 2 : 1);
    if (recovery !== 'direct') {
      const checkpoint = checkpoints.read('chat', 'exec')!;
      expect(checkpoint.stages.source_plan?.value).toMatchObject({ capturePlan: { http: [] } });
      expect(checkpoint.stages['source_plan-sources-1']?.value).toMatchObject({ capturePlan: { http: [{ alias: 'orders' }] } });
    }
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
      connections: [{ connector: 'rdb', connected: true, config: {
        type: 'postgres', connectionString: 'postgres://report@example.test/db',
        connectedAt: '2026-09-04T00:00:00.000Z',
      } }],
      artifactSink: { putBytes }, log: (entry) => logs.push(entry),
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
        inferSourceRequirements: async () => [],
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
      const changedConnection = await service.generate({ ...params, resumeExecutionId: 'exec-1' }, {
        ...ctx,
        executionId: 'changed-connection',
        connections: [{ connector: 'rdb', connected: true, config: {
          type: 'postgres', connectionString: 'postgres://different@example.test/db',
          connectedAt: '2026-09-06T00:00:00.000Z',
        } }],
      });
      expect(changedConnection.errorCode).toBe('report_checkpoint_input_changed');
    }
    const response = await service.generate({ ...params, ...(resume ? { resumeExecutionId: 'exec-1' } : {}) },
      { ...ctx, executionId: resume ? 'exec-2' : 'exec-1', ...(resume ? {
        connections: [{ connector: 'rdb', connected: true, config: {
          type: 'postgres', connectionString: 'postgres://report@example.test/db',
          connectedAt: '2026-09-06T00:00:00.000Z', lastError: 'transient connector warning',
        } }],
      } : {}) });

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
        inferSourceRequirements: async () => [],
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
        inferSourceRequirements: async () => [],
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

  it('repairs a cached example-capacity limit before target rendering', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-target-capacity-'));
    const templatePath = join(root, 'template.pdf');
    const examplePath = join(root, 'example.pdf');
    writeFileSync(templatePath, 'template');
    writeFileSync(examplePath, 'example');
    const pair: PdfReportPairAnalysis = {
      schemaVersion: 1,
      pairId: 'pair', templateHash: 'template-hash', exampleHash: 'example-hash', pageCount: 1,
      pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
      scalarSlots: [],
      tableGroups: [{
        id: 'customers-group', columnCount: 1, rowCount: 2,
        rows: [0, 1].map((index) => ({ index, pageIndex: 0, y: 120 + index * 20, cells: [{
          id: `customer-${index}`, pageIndex: 0,
          rect: { x: 60, y: 120 + index * 20, width: 80, height: 12 },
          exampleText: ['A', 'B'][index]!, fontSize: 9, font: 'Fixture', color: 0,
        }] })),
      }],
      templateImages: [], exampleImages: [],
    };
    const targetValues: Array<Record<string, unknown>> = [];
    const documentEngine = {
      pdfReportAnalyze: vi.fn(async () => pair),
      pdfFormFill: vi.fn(async (path: string, options: { outputPath?: string; values: Record<string, unknown> }) => {
        targetValues.push(options.values);
        writeFileSync(options.outputPath!, 'pdf');
        return {
          sourcePath: path, outputPath: options.outputPath!, sourceHash: 'template-hash', outputHash: 'output-hash',
          pageCount: 1, fieldCount: Object.keys(options.values).length, writerEngine: 'pymupdf' as const,
          verified: true, interactive: false, sourceUnchanged: true,
        };
      }),
    };
    let readCount = 0;
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({
        source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: id === 'template' ? templatePath : examplePath },
      }) },
      documentEngine,
      planner: {
        inferSourceRequirements: async () => [],
        inferCapturePlan: async () => ({
          schemaVersion: 1,
          examplePeriod: { start: '2037-05-01', endInclusive: '2037-05-31', label: 'example' },
          targetPeriod: { start: '2037-06-01', endInclusive: '2037-06-30', label: 'target' },
          capturePlan: { schemaVersion: 1, http: [], rdb: [{ alias: 'orders', table: 'public.orders' }] },
        }),
        inferReportPlan: async () => ({
          schemaVersion: 1,
          reportPlan: {
            schemaVersion: 1, baseSource: 'orders', joins: [], scalars: [], texts: [],
            tables: [{
              kind: 'aggregate' as const, id: 'customers', limit: 2,
              groupBy: [{ id: 'customer', value: { kind: 'field' as const, path: 'orders.customer_id' } }],
              columns: [{ id: 'customer', value: { kind: 'group_key' as const, keyId: 'customer' } }],
            }],
          },
          layout: {
            schemaVersion: 1, outputFileName: 'report.pdf', scalarBindings: [],
            tableBindings: [{ groupId: 'customers-group', tableId: 'customers', columns: [{ columnIndex: 0, columnId: 'customer' }] }],
          },
        }),
      },
      getConnector: () => ({
        name: 'rdb',
        execute: async (action: string) => {
          if (action === 'schema.describe') return { ok: true, data: ['public.orders'] };
          readCount += 1;
          const rows = readCount === 1 ? [['A'], ['B']] : [['A'], ['B'], ['C']];
          return { ok: true, data: buildTableArtifact({ id: 'orders', headers: ['customer_id'], matrix: rows }) };
        },
      }),
      makeTemporaryDirectory: () => join(root, 'output'),
    });

    const response = await service.generate({ goal: 'customer report', templateSourceId: 'template', exampleSourceId: 'example' }, {
      executionId: 'exec', workspaceSessionId: 'chat', variables: {}, connections: [],
      artifactSink: { putBytes: (bytes, options) => ({ id: 'artifact', sha256: 'sha', fileName: options.fileName, mimeType: options.mimeType, size: bytes.length, createdAt: '2037-06-01' }) },
      log: vi.fn(),
    });

    expect(response.ok).toBe(true);
    expect(targetValues).toHaveLength(1);
    expect(Object.values(targetValues[0]!)).toContain('C');
  });
});
