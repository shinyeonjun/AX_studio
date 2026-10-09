import { z } from 'zod';
import type { ExecutionLogEntry } from '../../../connectors/types.js';
import type { InvestigationRunner } from '../../../intelligence/agent/investigation-runner.js';
import type { ModelImageInput } from '../../../intelligence/agent/model/provider.js';
import type { PdfReportSpans, PdfReportValueRemoval } from '../../read/types/pdf.js';
import { boundedJson } from './planning-context.js';

const ExampleValuesSchema = z.object({
  values: z.array(z.object({
    spanId: z.string().min(1).max(64),
    /** The part of the span that changes; the whole span when all of it does. */
    value: z.string().min(1).max(2_000),
  })).max(2_000),
});

const EXAMPLE_VALUES_GOAL = [
  'The document is a completed periodic report (for example last month\'s). There is no blank form.',
  'Mark every piece of text that is this period\'s content and would be different in the next period\'s report:',
  'amounts, counts, rates, dates and period labels (2026-09, 9월, Q3), names and items listed in table rows, computed totals, and sentences that state results.',
  'Do not mark the form itself: the report title without its period, section headings, field labels, table column headers, units shown as headers, the company or department name, fixed notes and page furniture.',
  'When one span holds a label and its value ("합계: 1,000", "기간 2026-09"), return only the value part as `value`, copied exactly from the span text.',
  'Return spanId values only from the supplied spans. Use the page images to see which text sits in table rows and which is a header.',
].join(' ');

const MAX_EXAMPLE_IMAGE_BYTES = 8 * 1024 * 1024;

function compact(text: string): string {
  return text.split(/\s+/u).join('');
}

/** Without a usable model answer: text with a digit in it is the period's numbers and dates. */
function digitValues(spans: PdfReportSpans['spans']): Array<{ spanId: string; value: string }> {
  return spans.filter((span) => /\p{Nd}/u.test(span.text)).map((span) => ({ spanId: span.id, value: span.text }));
}

/**
 * Which text of a completed report is this period's values, as removals from its page. Only spans
 * the engine listed can be named, and only text a span actually holds can be taken out of it.
 */
export async function inferExampleValues(runner: InvestigationRunner, input: {
  goal: string;
  spans: PdfReportSpans;
  readImage: (path: string) => Uint8Array;
  maxChars: number;
  signal?: AbortSignal;
  log?: (entry: ExecutionLogEntry) => void;
}): Promise<PdfReportValueRemoval[]> {
  const spans = input.spans.spans;
  if (spans.length === 0) throw new Error('report_example_has_no_text');
  const images: ModelImageInput[] = [];
  let totalBytes = 0;
  for (const [index, path] of input.spans.exampleImages.entries()) {
    const data = input.readImage(path);
    totalBytes += data.byteLength;
    if (totalBytes > MAX_EXAMPLE_IMAGE_BYTES) throw new Error('report_evidence_image_limit');
    images.push({ data, mimeType: 'image/png', pageIndex: index, filename: `example-page-${index + 1}.png` });
  }
  const result = await runner.run({
    outputSchema: ExampleValuesSchema,
    context: {
      skillGoal: EXAMPLE_VALUES_GOAL,
      taskGoal: input.goal,
      evidence: [{ source: 'pdf-text', detail: 'Spans are the report text in reading order with page and box (points, top-left origin).' }],
      untrustedData: boundedJson({
        pages: input.spans.pages,
        spans: spans.map((span) => ({ spanId: span.id, page: span.pageIndex, text: span.text,
          x: Math.round(span.rect.x), y: Math.round(span.rect.y), fontSize: span.fontSize })),
      }, input.maxChars),
      connectedConnectors: ['document'],
    },
    user: input.goal,
    images,
    logContext: 'report-example-values',
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });
  const byId = new Map(spans.map((span) => [span.id, span]));
  const chosen = result.output.values.filter((entry) => {
    const span = byId.get(entry.spanId);
    return span !== undefined && compact(span.text).includes(compact(entry.value));
  });
  const values = chosen.length > 0 ? chosen : digitValues(spans);
  input.log?.({ at: new Date().toISOString(), level: chosen.length > 0 ? 'info' : 'warn',
    code: chosen.length > 0 ? 'report_example_values_found' : 'report_example_values_from_digits',
    message: chosen.length > 0 ? '완성 보고서에서 기간마다 바뀌는 값을 찾았습니다.' : '값을 확실히 고르지 못해 숫자가 든 글자를 값으로 보고 진행합니다.',
    data: { values: values.length, spans: spans.length } });
  if (values.length === 0) throw new Error('report_example_values_not_found');
  const seen = new Set<string>();
  return values.flatMap(({ spanId, value }) => {
    const key = `${spanId}\u0000${compact(value)}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const span = byId.get(spanId)!;
    return [{ pageIndex: span.pageIndex, rect: span.rect, text: value }];
  });
}
