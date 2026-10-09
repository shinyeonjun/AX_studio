import { z } from 'zod';
import type { ExecutionLogEntry } from '../../../connectors/types.js';
import type { InvestigationRunner } from '../../../intelligence/agent/investigation-runner.js';
import type { ModelImageInput } from '../../../intelligence/agent/model/provider.js';
import type { PdfReportSpans, PdfReportValueRemoval } from '../../read/types/pdf.js';
import { boundedJson } from './planning-context.js';
import { dateMentions } from '../period-mentions.js';

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
  'Return spanId values only from the supplied spans. Use the page images, or the location of each span in a Word report, to see which text sits in table rows and which is a header.',
].join(' ');

const RemainingNumbersSchema = z.object({
  changing: z.array(z.number().int().nonnegative()).max(2_000),
});

const REMAINING_NUMBERS_GOAL = [
  'The document is a completed periodic report. Some of its text was already marked as the values of this period (shown as ▢).',
  'The numbers listed were not marked. For each, decide whether it is content of this period that would be different next period',
  '(a count, amount, rate, total, date part or result) or part of the form that stays (a fixed limit such as 상위 5개, a model name, a version, a phone number, a fixed note).',
  'Return the ids of the numbers that change. When unsure whether a number is a result of the data of the period, it changes.',
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
  // A Word report's spans say where they sit in words; a PDF's are placed by box and page image.
  const wordReport = spans.every((span) => span.location !== undefined);
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
      evidence: [wordReport
        ? { source: 'docx-text', detail: 'Spans are the Word report paragraphs in reading order; location says whether a paragraph is body text, a header or footer, or which table row and column it is in.' }
        : { source: 'pdf-text', detail: 'Spans are the report text in reading order with page and box (points, top-left origin).' }],
      untrustedData: boundedJson(wordReport
        ? { spans: spans.map((span) => ({ spanId: span.id, location: span.location, text: span.text })) }
        : {
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
  const picked = chosen.length > 0 ? chosen : digitValues(spans);
  // A dated report's dates change with its period: a full date left unmarked would carry last
  // period's date into the new report, so the host marks every one the model passed over.
  // A bare month ("8월") is a date only when it is the month the report is about: the month of
  // its full dates, or, without any, the one month it keeps naming.
  const mentions = spans.flatMap((span) => dateMentions(span.text));
  const fullMonths = new Set(mentions.filter((mention) => mention.year !== undefined).map((mention) => mention.month));
  const bareMonths = new Set(mentions.filter((mention) => mention.year === undefined).map((mention) => mention.month));
  const reportMonths = fullMonths.size > 0 ? fullMonths : bareMonths.size === 1 ? bareMonths : new Set<number>();
  const dated = spans.flatMap((span) => dateMentions(span.text)
    .filter((mention) => mention.year !== undefined || reportMonths.has(mention.month))
    .filter((mention) => !picked.some((entry) => entry.spanId === span.id && compact(entry.value).includes(compact(mention.text))))
    .map((mention) => ({ spanId: span.id, value: mention.text })));
  // A picked part of a date ("8월" of "2026년 8월") gives way to the whole date.
  const values: Array<{ spanId: string; value: string }> = [...picked.filter((entry) => !dated.some((date) => date.spanId === entry.spanId
    && compact(date.value).includes(compact(entry.value)))), ...dated];
  if (dated.length > 0) {
    input.log?.({ at: new Date().toISOString(), level: 'info', code: 'report_example_dates_marked',
      message: '값으로 고르지 않은 날짜도 기간마다 바뀌는 값으로 표시했습니다.', data: { dates: dated.length } });
  }
  values.push(...await remainingNumberValues(runner, input, spans, values));
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
    return [{ spanId, pageIndex: span.pageIndex, rect: span.rect, text: value }];
  });
}

/** Numbers in a span's text outside the marked values, not glued to a word ("A4", "v2"). */
// The value is the number with one unit letter ("126건"); the model judges it as the whole word it
// sits in, so "1건당 평균" reads as the phrase it is and "8,466,900원이며" as an amount.
const NUMBER = /(?<![\p{L}\d.,])([+-]?\d(?:[\d,]*\d)?(?:\.\d+)?(?:%|\p{L})?)(\p{L}*)/gu;

/**
 * Every number gets a decision. A long list makes a model pass over a number now and then, and
 * an unmarked number is copied into next period's report unchanged; so the numbers left after
 * the first pass are asked about again, on their own, with the sentence around each.
 */
async function remainingNumberValues(
  runner: InvestigationRunner,
  input: { goal: string; maxChars: number; signal?: AbortSignal; log?: (entry: ExecutionLogEntry) => void },
  spans: PdfReportSpans['spans'],
  values: Array<{ spanId: string; value: string }>,
): Promise<Array<{ spanId: string; value: string }>> {
  const candidates: Array<{ id: number; spanId: string; number: string; word: string; text: string }> = [];
  for (const span of spans) {
    const marked = values.filter((entry) => entry.spanId === span.id)
      .reduce((text, entry) => text.split(entry.value).join('▢'), span.text);
    for (const match of marked.matchAll(NUMBER)) {
      candidates.push({ id: candidates.length, spanId: span.id, number: match[1]!, word: match[0], text: marked });
    }
  }
  if (candidates.length === 0) return [];
  const result = await runner.run({
    outputSchema: RemainingNumbersSchema,
    context: {
      skillGoal: REMAINING_NUMBERS_GOAL,
      taskGoal: input.goal,
      evidence: [{ source: 'report-text', detail: 'Each item is one unmarked number and the text it sits in.' }],
      untrustedData: boundedJson({ numbers: candidates.map(({ id, word, text }) => ({ id, number: word, text })) }, input.maxChars),
      connectedConnectors: ['document'],
    },
    user: input.goal,
    logContext: 'report-example-remaining-numbers',
    ...(input.signal ? { abortSignal: input.signal } : {}),
  });
  const changing = new Set(result.output.changing);
  const added = candidates.filter((candidate) => changing.has(candidate.id))
    .map((candidate) => ({ spanId: candidate.spanId, value: candidate.number }));
  input.log?.({ at: new Date().toISOString(), level: 'info', code: 'report_example_numbers_rechecked',
    message: '값으로 고르지 않은 숫자를 한 번 더 확인했습니다.',
    data: { numbers: candidates.length, added: added.length } });
  return added;
}

