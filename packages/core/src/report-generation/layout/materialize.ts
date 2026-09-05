import type {
  PdfFormField,
  PdfFormRect,
  PdfFormTemplate,
  PdfReportPairAnalysis,
  PdfReportSlot,
} from '../../document-engine/types/pdf.js';
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
    if (table.rows.length > group.rowCount) throw new Error(`report_table_capacity_exceeded:${binding.groupId}`);
    unique(binding.columns.map((column) => String(column.columnIndex)), `report_layout_duplicate_column_index:${binding.groupId}`);
    unique(binding.columns.map((column) => column.columnId), `report_layout_duplicate_column:${binding.groupId}`);
    if (binding.columns.length !== group.columnCount) throw new Error(`report_layout_column_binding_incomplete:${binding.groupId}`);

    for (const column of binding.columns) {
      if (column.columnIndex >= group.columnCount || !table.columns.includes(column.columnId)) {
        throw new Error(`report_layout_column_invalid:${binding.groupId}:${column.columnId}`);
      }
    }
    for (const row of group.rows) {
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
