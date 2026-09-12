import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { InvestigationRunner, InvestigationRunRequest } from '../../intelligence/agent/investigation-runner.js';
import { buildHttpResponseArtifact } from '../../contracts/artifacts/http-response.js';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import type { ConnectorContext } from '../../connectors/types.js';
import { ReportPlanner } from './planner/planner.js';
import { ReportGenerationService } from './service.js';

type Mode = 'http-only' | 'db-only' | 'db-schema-page' | 'required-db' | 'selected-db' | 'db-read-failed' | 'late-db';
async function runReport(mode: Mode, schemaFailure: 'returned' | 'thrown' | 'invalid' = 'returned') {
  const seen: InvestigationRunRequest<unknown>[] = [];
  const healthySchema = ['db-only', 'db-schema-page', 'db-read-failed'].includes(mode);
  const dbSelected = ['db-only', 'db-schema-page', 'required-db', 'selected-db', 'db-read-failed'].includes(mode);
  const needs = mode === 'selected-db' ? [] : [{ id: 'facts', connector: dbSelected ? 'rdb' : 'http',
    description: 'Required measurements', reason: 'Explicitly selected by the user' }];
  const executeRdb = vi.fn(async (action: string, _params: Record<string, unknown>) => {
    if (action === 'schema.describe') {
      if (healthySchema) return { ok: true, data: ['measurements'] };
      if (schemaFailure === 'thrown') throw new Error('private-database-connection-details');
      return schemaFailure === 'invalid' ? { ok: true, data: { invalid: true } }
        : { ok: false, errorCode: 'rdb_error', error: 'private-database-connection-details' };
    }
    if (action === 'table.describe') return { ok: true, data: { table: 'measurements', columns: [{ name: 'id', type: 'integer' }],
      offset: 200, limit: 2, hasMore: false, nextOffset: null } };
    return mode === 'db-read-failed' ? { ok: false, errorCode: 'rdb_error' }
      : { ok: true, data: buildTableArtifact({ id: 'readings', headers: ['id'], matrix: [[1]] }) };
  });
  const executeHttp = vi.fn(async (_action: string, _params: Record<string, unknown>) => ({ ok: true, data: buildHttpResponseArtifact({ executionId: 'readings',
    url: 'https://api.test/measurements', status: 200, statusText: 'OK', headers: {}, body: '[{"id":1}]', truncated: false }) }));
  const capture = { schemaVersion: 1,
    examplePeriod: { start: '2040-01-01', endInclusive: '2040-01-31', label: 'example' },
    targetPeriod: { start: '2040-02-01', endInclusive: '2040-02-29', label: 'target' },
    capturePlan: { schemaVersion: 1,
      http: dbSelected ? [] : [{ alias: 'facts', connectionId: 'selected-api', path: '/measurements', rowsPath: '$' }],
      rdb: dbSelected ? [{ alias: 'facts', table: 'measurements' }] : [] },
    requirementBindings: needs.map(need => ({ requirementId: need.id, aliases: ['facts'] })),
  };
  const runner: InvestigationRunner = { providerName: 'test', async run<T>(request: InvestigationRunRequest<T>) {
    seen.push(request);
    let output: unknown;
    switch (request.logContext) {
      case 'report-source-requirements': output = { schemaVersion: 1, requirements: needs }; break;
      case 'report-source-plan': output = mode === 'db-schema-page'
        ? { schemaVersion: 1, status: 'need_evidence', request: { kind: 'rdb_table', table: 'measurements', offset: 200, limit: 2 } }
        : { schemaVersion: 1, status: 'planned', plan: capture }; break;
      case 'report-source-plan-inspect-1': output = { schemaVersion: 1, status: 'planned', plan: capture }; break;
      case 'report-source-refinement': output = capture; break;
      case 'report-business-plan': output = mode === 'late-db'
        ? { schemaVersion: 1, sourceRequest: [{ id: 'history', connector: 'rdb', description: 'Required history', reason: 'Missing historical facts' }] }
        : { schemaVersion: 1, reportPlan: { schemaVersion: 1, baseSource: 'facts', joins: [],
          scalars: [{ id: 'count', expression: { kind: 'count' } }], tables: [], texts: [] } }; break;
      case 'report-business-plan-evidence-1': output = mode === 'late-db'
        ? { schemaVersion: 1, sourceRequest: [{ id: 'history', connector: 'rdb', description: 'Required history', reason: 'Missing historical facts' }] }
        : { schemaVersion: 1, reportPlan: { schemaVersion: 1, baseSource: 'facts', joins: [],
          scalars: [{ id: 'count', expression: { kind: 'count' } }], tables: [], texts: [] } }; break;
      case 'report-layout-plan': output = { schemaVersion: 1, layout: { schemaVersion: 1, outputFileName: 'report.pdf',
        scalarBindings: [{ slotId: 'count', value: { kind: 'scalar', id: 'count' } }], tableBindings: [] } }; break;
      default: throw new Error(`unexpected_planner_call:${request.logContext}`);
    }
    return { output: request.outputSchema.parse(output) };
  } };
  const fill = vi.fn(async (path: string, options: { outputPath?: string }) => {
    writeFileSync(options.outputPath!, 'test-pdf');
    return { sourcePath: path, outputPath: options.outputPath!, sourceHash: 't', outputHash: 'out',
      pageCount: 1, fieldCount: 1, writerEngine: 'pypdf-reportlab' as const, verified: true, interactive: false, sourceUnchanged: true };
  });
  const putBytes = vi.fn((data: Uint8Array, options: { fileName: string; mimeType?: string }) => ({
    id: 'artifact', sha256: 'hash', size: data.length, ...options, createdAt: '2040-03-01T00:00:00Z',
  }));
  const log = vi.fn();
  const service = new ReportGenerationService({
    workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
    documentEngine: { pdfReportAnalyze: async () => ({ schemaVersion: 1, pairId: 'p', templateHash: 't', exampleHash: 'e',
      pageCount: 1, pages: [{ index: 0, width: 595, height: 842, rotation: 0 }], templateImages: [], exampleImages: [],
      scalarSlots: [{ id: 'count', pageIndex: 0, rect: { x: 10, y: 10, width: 30, height: 15 },
        exampleText: '1', fontSize: 10, font: 'Helvetica', color: 0 }], tableGroups: [] }), pdfFormFill: fill },
    planner: new ReportPlanner(runner), getConnector: name => name === 'rdb' ? { name, execute: executeRdb }
      : name === 'http' ? { name, execute: executeHttp } : undefined,
  });
  const ctx: ConnectorContext = { executionId: 'preflight', workspaceSessionId: 'session', variables: {}, log,
    artifactSink: { putBytes }, connections: [{ connector: 'http', connected: true,
      config: { endpoints: [{ id: 'selected-api', baseUrl: 'https://api.test' }, { id: 'other-api', baseUrl: 'https://other.test' }] } }] };
  const result = await service.generate({ goal: dbSelected ? 'Use the measurements database for this report.'
    : 'Use only /measurements on the selected API for this report.', templateSourceId: 'template', exampleSourceId: 'example' }, ctx);
  return { result, seen, executeHttp, executeRdb, fill, putBytes, log };
}

describe('report source preflight availability', () => {
  it.each(['returned', 'thrown', 'invalid'] as const)('lets HTTP-only reporting finish despite an unrelated %s DB failure', async failure => {
    const run = await runReport('http-only', failure);
    expect(run.result).toMatchObject({ ok: true });
    for (const phase of ['report-source-requirements', 'report-source-plan']) {
      const request = run.seen.find(item => item.logContext === phase)!;
      expect(JSON.parse(request.context.untrustedData!).unavailableSources).toEqual([
        expect.objectContaining({ connector: 'rdb', operation: 'schema.describe', available: false,
          reason: failure === 'invalid' ? 'schema_response_invalid' : 'schema_request_failed' }),
      ]);
    }
    expect(JSON.stringify([run.seen, run.log.mock.calls])).not.toContain('private-database');
    expect(run.executeRdb.mock.calls.map(([action]) => action)).toEqual(['schema.describe']);
    expect(run.executeHttp).toHaveBeenCalledTimes(3);
    expect(run.executeHttp.mock.calls.every(([, params]) => params.connectionId === 'selected-api')).toBe(true);
    expect(run.fill).toHaveBeenCalledTimes(1);
    expect(run.putBytes).toHaveBeenCalledTimes(1);
  });

  it('preserves a working DB-only selection and never falls back to HTTP', async () => {
    const run = await runReport('db-only');
    expect(run.result).toMatchObject({ ok: true });
    expect(run.executeRdb.mock.calls.map(([action]) => action)).toEqual(['schema.describe', 'query.read', 'query.read']);
    expect(run.executeHttp).not.toHaveBeenCalled();
    expect(run.fill).toHaveBeenCalledTimes(1);
  });

  it('forwards the model-selected DB schema page to the connector unchanged', async () => {
    const run = await runReport('db-schema-page');
    expect(run.result).toMatchObject({ ok: true });
    expect(run.executeRdb).toHaveBeenCalledWith('table.describe', { table: 'measurements', offset: 200, limit: 2 }, expect.anything());
    expect(JSON.parse(run.seen.find(request => request.logContext === 'report-source-plan-inspect-1')!.context.untrustedData!)
      .inspectedEvidence[0].result).toMatchObject({ offset: 200, limit: 2, columns: [{ name: 'id' }] });
    expect(run.executeHttp).not.toHaveBeenCalled();
  });

  it.each(['required-db', 'selected-db', 'late-db'] as const)('fails closed after semantic analysis identifies %s', async mode => {
    const run = await runReport(mode);
    expect(run.result).toMatchObject({ ok: false, errorCode: 'report_rdb_schema_failed' });
    expect(run.seen[0]?.logContext).toBe('report-source-requirements');
    expect(run.seen.filter(item => item.logContext === 'report-source-plan')).toHaveLength(mode === 'required-db' ? 0 : 1);
    expect(run.executeRdb.mock.calls.map(([action]) => action)).toEqual(['schema.describe']);
    expect(run.executeHttp).toHaveBeenCalledTimes(mode === 'late-db' ? 2 : 0);
    expect(run.fill).not.toHaveBeenCalled();
    expect(run.putBytes).not.toHaveBeenCalled();
  });

  it('does not replace a selected DB with HTTP when its row read fails', async () => {
    const run = await runReport('db-read-failed');
    expect(run.result).toMatchObject({ ok: false, errorCode: 'report_rdb_request_failed' });
    expect(run.seen.filter(item => item.logContext === 'report-source-plan')).toHaveLength(1);
    expect(run.executeHttp).not.toHaveBeenCalled();
    expect(run.fill).not.toHaveBeenCalled();
  });
});
