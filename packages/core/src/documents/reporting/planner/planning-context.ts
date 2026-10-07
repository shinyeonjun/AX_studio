import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { ModelImageInput } from '../../../intelligence/agent/model/provider.js';
import type { ReportSourceSnapshot } from '../plan/schema.js';

function sampleCalculationRows<T>(rows: T[]): T[] {
  if (rows.length <= 6) return rows;
  return [...rows.slice(0, 3), ...rows.slice(-3)];
}

/**
 * Date coverage is a compact, host-computed fact that helps the model choose
 * between similarly named source timestamps without exposing source rows.
 * Only ISO date-like strings are summarized; other business fields stay out
 * of this hint and remain available through the bounded evidence requests.
 */
export function sourceDateCoverage(
  sources: Record<string, ReportSourceSnapshot>,
  period: { start: string; endInclusive: string },
): Record<string, Record<string, {
  inPeriod: number;
  totalDates: number;
  minimum: string;
  maximum: string;
}>> {
  const coverage: Record<string, Record<string, {
    inPeriod: number;
    totalDates: number;
    minimum: string;
    maximum: string;
  }>> = {};
  for (const [source, snapshot] of Object.entries(sources)) {
    const byField = new Map<string, string[]>();
    for (const row of snapshot.rows) {
      for (const [field, value] of Object.entries(row)) {
        if (typeof value !== 'string') continue;
        const date = /^(\d{4}-\d{2}-\d{2})(?:T|\s|$)/u.exec(value)?.[1];
        if (!date) continue;
        const dates = byField.get(field);
        if (dates) dates.push(date);
        else byField.set(field, [date]);
      }
    }
    const fields: Record<string, {
      inPeriod: number;
      totalDates: number;
      minimum: string;
      maximum: string;
    }> = {};
    for (const [field, dates] of byField) {
      if (dates.length === 0) continue;
      const sorted = [...new Set(dates)].sort();
      fields[field] = {
        inPeriod: dates.filter((date) => date >= period.start && date <= period.endInclusive).length,
        totalDates: dates.length,
        minimum: sorted[0]!,
        maximum: sorted.at(-1)!,
      };
    }
    if (Object.keys(fields).length > 0) coverage[source] = fields;
  }
  return coverage;
}

/**
 * Calculation inference needs the semantic examples and table shape, while
 * layout inference owns the complete slot geometry. Keeping only the first
 * and last rows prevents a large repeated table from consuming the model's
 * context on every evidence turn.
 */
export function promptCalculationPair(pair: PdfReportPairAnalysis) {
  return {
    pageCount: pair.pageCount,
    pages: pair.pages,
    scalarSlots: pair.scalarSlots.map(({ id, pageIndex, rect, exampleText }) => ({
      id, pageIndex, rect, exampleText,
    })),
    tableGroups: pair.tableGroups.map((group) => {
      const rows = sampleCalculationRows(group.rows);
      return {
        id: group.id,
        columnCount: group.columnCount,
        rowCount: group.rowCount,
        pageBounds: group.pageBounds,
        rows: rows.map((row) => ({
          index: row.index,
          pageIndex: row.pageIndex,
          y: row.y,
          cells: row.cells.map(({ id, pageIndex, rect, exampleText }) => ({
            id, pageIndex, rect, exampleText,
          })),
        })),
        ...(rows.length < group.rows.length ? { sampled: true } : {}),
      };
    }),
  };
}

export function imagesForPair(pair: PdfReportPairAnalysis, readImage: (path: string) => Uint8Array): ModelImageInput[] {
  const images: ModelImageInput[] = [];
  let totalBytes = 0;
  for (const document of ['template', 'example'] as const) {
    for (const [index, path] of pair[`${document}Images`].entries()) {
      const data = readImage(path);
      totalBytes += data.byteLength;
      if (totalBytes > 8 * 1024 * 1024) throw new Error('report_evidence_image_limit');
      images.push({ data, mimeType: 'image/png', pageIndex: index, filename: `${document}-page-${index + 1}.png` });
    }
  }
  return images;
}

export function boundedJson(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value);
  if (serialized.length > maxChars) throw new Error('report_planning_context_too_large');
  return serialized;
}
