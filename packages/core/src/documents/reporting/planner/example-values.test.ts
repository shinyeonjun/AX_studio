import { describe, expect, it, vi } from 'vitest';
import type { PdfReportSpans } from '../../read/types/pdf.js';
import { inferExampleValues } from './example-values.js';

const spans: PdfReportSpans = {
  schemaVersion: 1, exampleHash: 'e', pageCount: 1, pages: [{ index: 0, width: 595, height: 842, rotation: 0 }],
  spans: [
    { id: 'title', pageIndex: 0, text: '2026년 9월 매출 보고서', rect: { x: 40, y: 40, width: 160, height: 14 }, fontSize: 14 },
    { id: 'label', pageIndex: 0, text: '거래처', rect: { x: 40, y: 70, width: 30, height: 10 }, fontSize: 10 },
    { id: 'total', pageIndex: 0, text: '합계: 1,800', rect: { x: 40, y: 90, width: 80, height: 10 }, fontSize: 10 },
  ],
  exampleImages: ['page-1.png'],
};

function runner(values: Array<{ spanId: string; value: string }>) {
  return { providerName: 'fixture', run: vi.fn(async (request: { outputSchema: { parse(value: unknown): unknown } }) => ({
    output: request.outputSchema.parse({ values }),
  })) };
}

describe('telling a completed report\'s values from its form', () => {
  it('takes out only text a listed span holds, with the page image as evidence', async () => {
    const model = runner([
      { spanId: 'title', value: '2026년 9월' },
      { spanId: 'total', value: '1,800' },
      { spanId: 'invented', value: '42' },
      { spanId: 'label', value: '다른 글' },
    ]);
    const removals = await inferExampleValues(model as never, { goal: '이번 달 보고서', spans, readImage: () => new Uint8Array([1]), maxChars: 100_000 });
    expect(removals).toEqual([
      { spanId: spans.spans[0]!.id, pageIndex: 0, rect: spans.spans[0]!.rect, text: '2026년 9월' },
      { spanId: spans.spans[2]!.id, pageIndex: 0, rect: spans.spans[2]!.rect, text: '1,800' },
    ]);
    expect((model.run.mock.calls[0]![0] as unknown as { images: unknown[] }).images).toHaveLength(1);
  });

  it('falls back to text with digits, and says so, when the answer names nothing usable', async () => {
    const log = vi.fn();
    const removals = await inferExampleValues(runner([]) as never, { goal: 'x', spans, readImage: () => new Uint8Array(), maxChars: 100_000, log });
    expect(removals.map((removal) => removal.text)).toEqual(['2026년 9월 매출 보고서', '합계: 1,800']);
    expect(log.mock.calls[0]![0]).toMatchObject({ code: 'report_example_values_from_digits' });
  });

  it('shows a Word report by where each paragraph sits, without page images or boxes', async () => {
    const word: PdfReportSpans = {
      ...spans,
      exampleImages: [],
      spans: spans.spans.map((span, index) => ({ ...span, location: index === 2 ? '본문 표1 6행 1열' : '본문 문단' })),
    };
    const model = runner([{ spanId: 'total', value: '1,800' }]);
    const removals = await inferExampleValues(model as never, { goal: '이번 달 보고서', spans: word, readImage: () => new Uint8Array([1]), maxChars: 100_000 });
    expect(removals).toEqual([{ spanId: 'total', pageIndex: 0, rect: spans.spans[2]!.rect, text: '1,800' }]);
    const request = model.run.mock.calls[0]![0] as unknown as { images: unknown[]; context: { untrustedData: string } };
    expect(request.images).toHaveLength(0);
    expect(request.context.untrustedData).toContain('본문 표1 6행 1열');
    expect(request.context.untrustedData).not.toContain('fontSize');
  });
});
