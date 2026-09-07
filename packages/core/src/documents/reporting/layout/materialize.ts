import type {
  PdfFormField,
  PdfFormRect,
  PdfFormTemplate,
  PdfReportPairAnalysis,
  PdfReportTableGroup,
  PdfReportTableRow,
  PdfReportSlot,
} from '../../read/types/pdf.js';
import type { ReportPrimitive } from '../plan/schema.js';
import type { ReportPlanResult } from '../plan/execute.js';
import { ReportLayoutPlanSchema, type ReportLayoutPlan, type ReportLayoutValue } from './schema.js';

export interface MaterializedReportLayout {
  template: PdfFormTemplate;
  values: Record<string, string>;
}

function normalized(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function unique(values: string[], code: string): void {
  if (new Set(values).size !== values.length) throw new Error(code);
}

function displayValue(
  binding: ReportLayoutValue,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): string {
  if (binding.kind === 'scalar') {
    const scalar = result.scalars[binding.id];
    if (!scalar) throw new Error(`report_layout_scalar_missing:${binding.id}`);
    return scalar.display;
  }
  if (binding.kind === 'text') {
    const text = result.texts[binding.id];
    if (text === undefined) throw new Error(`report_layout_text_missing:${binding.id}`);
    return text;
  }
  const value = metadata[binding.key];
  if (value === undefined) throw new Error(`report_layout_metadata_missing:${binding.key}`);
  return String(value ?? '');
}

function textColor(color: number): [number, number, number] {
  const red = (color >> 16) & 0xff;
  const green = (color >> 8) & 0xff;
  const blue = color & 0xff;
  return [red / 255, green / 255, blue / 255];
}

function field(slot: PdfReportSlot, rect: PdfFormRect = slot.rect): PdfFormField {
  return {
    id: slot.id,
    name: slot.id,
    label: slot.id,
    pageIndex: slot.pageIndex,
    rect,
    type: 'text',
    source: 'layout_hint',
    confidence: 1,
    required: true,
    multiline: false,
    fontSize: slot.fontSize,
    textColor: textColor(slot.color),
    align: 'left',
  };
}

const CONTINUATION_PAGE_MARGIN = 24;
const CONTINUATION_CONTENT_GAP = 4;

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

function continuationFieldId(groupId: string, rowIndex: number, columnIndex: number): string {
  return `overflow-${groupId}-${rowIndex}-${columnIndex}`;
}

function groupHorizontalBounds(
  group: PdfReportTableGroup,
  pageIndex: number,
  fallbackRow: PdfReportTableRow,
): { left: number; right: number } {
  const pageBound = group.pageBounds?.find((bound) => bound.pageIndex === pageIndex);
  if (pageBound) return { left: pageBound.x, right: pageBound.x + pageBound.width };
  const cells = group.rows
    .filter((row) => row.pageIndex === pageIndex)
    .flatMap((row) => row.cells);
  const source = cells.length > 0 ? cells : fallbackRow.cells;
  return {
    left: Math.min(...source.map((cell) => cell.rect.x)),
    right: Math.max(...source.map((cell) => cell.rect.x + cell.rect.width)),
  };
}

function overlapsHorizontally(
  bounds: { left: number; right: number },
  x: number,
  width: number,
): boolean {
  return x < bounds.right && x + width > bounds.left;
}

/**
 * A template's detected rows are a geometry sample, not a business limit. If
 * a target contains more groups, append rows only in the verified vertical
 * gap before the next detected item on that page. A missing safe gap fails
 * closed so a row can never be silently clipped or painted over another
 * section.
 */
function rowsForResult(
  pair: PdfReportPairAnalysis,
  group: PdfReportTableGroup,
  resultRowCount: number,
): PdfReportTableRow[] {
  if (resultRowCount <= group.rowCount) return group.rows;
  const orderedRows = [...group.rows].sort((left, right) => (
    left.pageIndex - right.pageIndex || left.y - right.y || left.index - right.index
  ));
  const last = orderedRows.at(-1);
  if (!last || last.cells.length === 0) {
    throw new Error(`report_table_capacity_exceeded:${group.id}`);
  }
  const page = pair.pages[last.pageIndex];
  if (!page) throw new Error(`report_table_capacity_exceeded:${group.id}`);

  const samePageRows = orderedRows.filter((row) => row.pageIndex === last.pageIndex);
  const pitches = samePageRows.slice(1).map((row, index) => row.y - samePageRows[index]!.y)
    .filter((pitch) => Number.isFinite(pitch) && pitch > 0);
  const rowHeight = Math.max(...last.cells.map((cell) => cell.rect.height), 1);
  const pitch = median(pitches) ?? Math.max(rowHeight * 1.5, 12);
  const horizontalBounds = groupHorizontalBounds(group, last.pageIndex, last);
  const nextDynamicY = [
    ...pair.scalarSlots
      .filter((slot) => slot.pageIndex === last.pageIndex && slot.rect.y > last.y
        && overlapsHorizontally(horizontalBounds, slot.rect.x, slot.rect.width))
      .map((slot) => slot.rect.y),
    ...pair.tableGroups
      .filter((other) => other.id !== group.id)
      .flatMap((other) => other.rows
        .filter((row) => row.pageIndex === last.pageIndex && row.y > last.y
          && row.cells.some((cell) => overlapsHorizontally(horizontalBounds, cell.rect.x, cell.rect.width))))
      .map((row) => row.y),
    page.height - CONTINUATION_PAGE_MARGIN,
  ];
  const boundary = Math.min(...nextDynamicY);
  const rows = [...group.rows];
  for (let offset = 0; rows.length < resultRowCount; offset += 1) {
    const rowIndex = group.rowCount + offset;
    const y = last.y + pitch * (offset + 1);
    if (!Number.isFinite(boundary) || y + rowHeight > boundary - CONTINUATION_CONTENT_GAP) {
      throw new Error(`report_table_capacity_exceeded:${group.id}`);
    }
    const delta = y - last.y;
    rows.push({
      index: rowIndex,
      pageIndex: last.pageIndex,
      y,
      cells: last.cells.map((slot, columnIndex) => ({
        ...slot,
        id: continuationFieldId(group.id, rowIndex, columnIndex),
        rect: { ...slot.rect, y: slot.rect.y + delta },
        exampleText: '',
      })),
    });
  }
  return rows;
}

export function materializeReportLayout(
  pair: PdfReportPairAnalysis,
  input: ReportLayoutPlan,
  result: ReportPlanResult,
  metadata: Record<string, ReportPrimitive>,
): MaterializedReportLayout {
  const layout = ReportLayoutPlanSchema.parse(input);
  unique(layout.scalarBindings.map((binding) => binding.slotId), 'report_layout_duplicate_scalar_slot');
  unique(layout.tableBindings.map((binding) => binding.groupId), 'report_layout_duplicate_table_group');

  const scalarSlots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  if (layout.scalarBindings.length !== scalarSlots.size) throw new Error('report_layout_scalar_binding_incomplete');
  const values: Record<string, string> = {};
  const fields: PdfFormField[] = [];
  for (const binding of layout.scalarBindings) {
    const slot = scalarSlots.get(binding.slotId);
    if (!slot) throw new Error(`report_layout_slot_missing:${binding.slotId}`);
    values[slot.id] = displayValue(binding.value, result, metadata);
    fields.push(field(slot));
  }

  const groups = new Map(pair.tableGroups.map((group) => [group.id, group]));
  if (layout.tableBindings.length !== groups.size) throw new Error('report_layout_table_binding_incomplete');
  for (const binding of layout.tableBindings) {
    const group = groups.get(binding.groupId);
    if (!group) throw new Error(`report_layout_group_missing:${binding.groupId}`);
    const table = result.tables[binding.tableId];
    if (!table) throw new Error(`report_layout_table_missing:${binding.tableId}`);
    const rows = rowsForResult(pair, group, table.rows.length);
    unique(binding.columns.map((column) => String(column.columnIndex)), `report_layout_duplicate_column_index:${binding.groupId}`);
    unique(binding.columns.map((column) => column.columnId), `report_layout_duplicate_column:${binding.groupId}`);
    if (binding.columns.length !== group.columnCount) throw new Error(`report_layout_column_binding_incomplete:${binding.groupId}`);

    for (const column of binding.columns) {
      if (column.columnIndex >= group.columnCount || !table.columns.includes(column.columnId)) {
        throw new Error(`report_layout_column_invalid:${binding.groupId}:${column.columnId}`);
      }
    }
    for (const row of rows) {
      const resultRow = table.rows[row.index];
      const pageBound = group.pageBounds?.find((bound) => bound.pageIndex === row.pageIndex);
      for (const column of binding.columns) {
        const slot = row.cells[column.columnIndex]!;
        const next = row.cells[column.columnIndex + 1];
        const page = pair.pages[slot.pageIndex]!;
        const right = next
          ? next.rect.x - 2
          : pageBound
            ? pageBound.x + pageBound.width - 4
            : page.width - 24;
        const rect = { ...slot.rect, width: Math.max(slot.rect.width, right - slot.rect.x) };
        values[slot.id] = resultRow?.display[column.columnId] ?? '';
        fields.push(field(slot, rect));
      }
    }
  }

  return {
    template: {
      schemaVersion: 1,
      templateId: pair.pairId,
      sourceName: layout.outputFileName,
      sourceHash: pair.templateHash,
      pageCount: pair.pageCount,
      coordinateSpace: 'pdf-user-top-left-unrotated',
      engine: 'layout_hint',
      mode: 'overlay',
      requiresReview: false,
      warnings: [],
      pages: pair.pages,
      fields,
      createdAt: new Date().toISOString(),
    },
    values,
  };
}

export interface ReportReplayResult {
  ok: boolean;
  mismatches: Array<{ slotId: string; expected: string; actual: string }>;
}

export function verifyReportExampleReplay(
  pair: PdfReportPairAnalysis,
  values: Record<string, string>,
): ReportReplayResult {
  const slots = [
    ...pair.scalarSlots,
    ...pair.tableGroups.flatMap((group) => group.rows.flatMap((row) => row.cells)),
  ];
  const mismatches = slots.flatMap((slot) => {
    const actual = values[slot.id] ?? '';
    return normalized(actual) === normalized(slot.exampleText)
      ? []
      : [{ slotId: slot.id, expected: slot.exampleText, actual }];
  });
  return { ok: mismatches.length === 0, mismatches };
}
