import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext } from '../../connectors/types.js';
import { buildHttpResponseArtifact } from '../../contracts/artifacts/http-response.js';
import type { DocumentEngineClient } from '../read/engine-client.js';
import type { PdfReportPairAnalysis } from '../read/types.js';
import { ReportGenerationService } from './service.js';

const pair: PdfReportPairAnalysis = {
  schemaVersion: 1, pairId: 'synthetic', templateHash: 'template', exampleHash: 'example', pageCount: 1,
  pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
  scalarSlots: [{ id: 'count', pageIndex: 0, rect: { x: 1, y: 1, width: 20, height: 10 },
    exampleText: '0', fontSize: 10, font: 'fixture', color: 0 }],
  tableGroups: [], templateImages: [], exampleImages: [],
};

function createService(directory: string,
  pdfReportAnalyze: DocumentEngineClient['pdfReportAnalyze'],
  pdfFormFill: DocumentEngineClient['pdfFormFill']) {
  return new ReportGenerationService({
    workspaceSources: { resolveStoredFile: (_session, id) => ({
      source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: join(directory, `${id}.pdf`) },
    }) },
    documentEngine: { pdfReportAnalyze, pdfFormFill },
    planner: {
      inferSourceRequirements: async () => [],
      inferCapturePlan: async () => ({ schemaVersion: 1,
        examplePeriod: { start: '2031-03-01', endInclusive: '2031-03-31', label: 'example' },
        targetPeriod: { start: '2031-04-01', endInclusive: '2031-04-30', label: 'target' },
        capturePlan: { schemaVersion: 1, http: [{ alias: 'items', connectionId: 'fixture', path: '/items', rowsPath: '$' }], rdb: [] } }),
      refineCapturePlan: async ({ provisional }) => provisional,
      inferReportPlan: async () => ({ schemaVersion: 1,
        reportPlan: { schemaVersion: 1, baseSource: 'items', joins: [],
          scalars: [{ id: 'count', expression: { kind: 'count' } }], tables: [], texts: [] },
        layout: { schemaVersion: 1, outputFileName: 'synthetic.pdf',
          scalarBindings: [{ slotId: 'count', value: { kind: 'scalar', id: 'count' } }], tableBindings: [] } }),
    },
    getConnector: name => name === 'http' ? { name, execute: async () => ({ ok: true,
      data: buildHttpResponseArtifact({ executionId: 'synthetic', url: 'https://fixture.invalid/items',
        status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '[]', truncated: false }) }) } : undefined,
  });
}

function context(signal: AbortSignal, putBytes = vi.fn()): ConnectorContext {
  return { executionId: 'synthetic', workspaceSessionId: 'synthetic', variables: {}, log: vi.fn(),
    abortSignal: signal, artifactSink: { putBytes },
    connections: [{ connector: 'http', connected: true,
      config: { endpoints: [{ id: 'fixture', baseUrl: 'https://fixture.invalid' }] } }],
  };
}

const params = { goal: 'Synthetic count report from /items', templateSourceId: 'template', exampleSourceId: 'example' };

describe('report document worker cancellation', () => {
  it.each(['late', 'reject'] as const)('forwards pair analysis cancellation and stops before planning: %s', async outcome => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-report-pair-cancel-'));
    try {
      const controller = new AbortController();
      const analyze = vi.fn<DocumentEngineClient['pdfReportAnalyze']>(async () => {
        controller.abort();
        if (outcome === 'reject') throw Object.assign(new Error('ABORT_ERR'), { code: 'ABORT_ERR' });
        return pair;
      });
      const fill = vi.fn<DocumentEngineClient['pdfFormFill']>();
      const service = createService(directory, analyze, fill);
      const ctx = context(controller.signal);
      expect(await service.generate(params, ctx)).toMatchObject({ ok: false, errorCode: 'agent_aborted' });
      expect(analyze.mock.calls[0]?.[2]).toEqual({ abortSignal: controller.signal });
      expect(fill).not.toHaveBeenCalled();
      expect(ctx.artifactSink!.putBytes).not.toHaveBeenCalled();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('cleans output files and suppresses late artifacts across 25 cancellations and 25 retries', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-report-fill-cancel-'));
    try {
      writeFileSync(join(directory, 'template.pdf'), 'synthetic template, not PDF bytes');
      writeFileSync(join(directory, 'example.pdf'), 'synthetic example, not PDF bytes');
      let controller = new AbortController();
      let cancel = false;
      let outputPath = '';
      const analyze = vi.fn<DocumentEngineClient['pdfReportAnalyze']>(async () => pair);
      const fill = vi.fn<DocumentEngineClient['pdfFormFill']>(async (sourcePath, options) => {
        outputPath = options.outputPath!;
        writeFileSync(outputPath, 'synthetic output, not PDF bytes');
        if (cancel) {
          controller.abort();
          if (fill.mock.calls.length % 4 === 1) throw Object.assign(new Error('ABORT_ERR'), { code: 'ABORT_ERR' });
        }
        return { sourcePath, outputPath, sourceHash: 'template', outputHash: 'output',
          pageCount: 1, fieldCount: 1, writerEngine: 'pypdf-reportlab', verified: true,
          interactive: false, sourceUnchanged: true };
      });
      const sink = vi.fn(() => ({ id: 'synthetic-artifact', sha256: 'synthetic', fileName: 'synthetic.pdf',
        mimeType: 'application/pdf', size: 1, createdAt: '2031-04-01T00:00:00Z' }));
      const service = createService(directory, analyze, fill);
      for (let index = 0; index < 50; index++) {
        controller = new AbortController();
        cancel = index % 2 === 0;
        const ctx = context(controller.signal, sink);
        const result = await service.generate(params, ctx);
        expect(result, JSON.stringify(result)).toMatchObject(cancel ? { ok: false, errorCode: 'agent_aborted' } : { ok: true });
        expect(fill.mock.calls[index]?.[2]).toEqual({ abortSignal: controller.signal });
        expect(existsSync(outputPath)).toBe(false);
        expect(existsSync(dirname(outputPath))).toBe(false);
        if (cancel) expect(ctx.log).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'pdf_generated' }));
      }
      expect(fill).toHaveBeenCalledTimes(50);
      expect(sink).toHaveBeenCalledTimes(25);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
