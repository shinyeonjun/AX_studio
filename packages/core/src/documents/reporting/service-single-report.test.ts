import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext } from '../../connectors/types.js';
import type { PdfReportSpans } from '../read/types/pdf.js';
import { ReportGenerationService } from './service.js';

const spans: PdfReportSpans = {
  schemaVersion: 1, exampleHash: 'e', pageCount: 1, pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
  spans: [
    { id: 'title', pageIndex: 0, text: '월간 매출 보고서', rect: { x: 40, y: 40, width: 120, height: 14 }, fontSize: 14 },
    { id: 'total', pageIndex: 0, text: '합계: 1,800', rect: { x: 40, y: 80, width: 90, height: 10 }, fontSize: 10 },
  ],
  exampleImages: [],
};

describe('a report from last period\'s completed report alone', () => {
  it('takes this period\'s values out of it and compares that blank form with the report', async () => {
    const order: string[] = [];
    const blank = vi.fn(async (_example: string, _removals: unknown, outputPath: string) => {
      order.push('blank');
      return { templatePath: outputPath };
    });
    const analyze = vi.fn(async (templatePath: string) => {
      order.push(`analyze:${templatePath.endsWith('blank-template.pdf') ? 'derived' : templatePath}`);
      return { schemaVersion: 1 as const, pairId: 'p', templateHash: 't', exampleHash: 'e', pageCount: 1,
        pages: [], scalarSlots: [], tableGroups: [], templateImages: [], exampleImages: [] };
    });
    const inferExampleValues = vi.fn(async () => [{ pageIndex: 0, rect: spans.spans[1]!.rect, text: '1,800' }]);
    const service = new ReportGenerationService({
      workspaceSources: { resolveStoredFile: (_session, id) => ({ source: { id, fileName: `${id}.pdf` }, artifact: { storedPath: `${id}.pdf` } }) },
      documentEngine: {
        pdfReportSpans: vi.fn(async () => { order.push('spans'); return spans; }),
        pdfReportBlank: blank, pdfReportAnalyze: analyze, pdfFormFill: vi.fn(),
      },
      planner: {
        inferExampleValues,
        inferSourceRequirements: async () => { throw new Error('report_evidence_ambiguous_rule'); },
        inferCapturePlan: vi.fn(), inferReportPlan: vi.fn(),
      },
      getConnector: () => undefined,
    });

    const result = await service.generate({ goal: '지난달 보고서로 이번 달 보고서 써 줘', exampleSourceId: 'august' }, {
      workspaceSessionId: 'session', artifactSink: { putBytes: vi.fn() }, log: vi.fn(),
    } as unknown as ConnectorContext);

    expect(order).toEqual(['spans', 'blank', 'analyze:derived']);
    expect(inferExampleValues).toHaveBeenCalledWith(expect.objectContaining({ spans }));
    expect(blank.mock.calls[0]![0]).toBe('august.pdf');
    expect(blank.mock.calls[0]![1]).toEqual([{ pageIndex: 0, rect: spans.spans[1]!.rect, text: '1,800' }]);
    expect(result).toMatchObject({ ok: false, errorCode: 'report_evidence_ambiguous_rule' });
  });
});
