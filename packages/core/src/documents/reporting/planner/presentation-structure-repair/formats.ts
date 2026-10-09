import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../../layout/schema.js';
import type { ReportFormat, ReportPlan, ReportPrimitive } from '../../plan/schema.js';
import { normalizeReportText } from '../../plan/reusability.js';
import { formatFromExampleText } from '../replay-repair.js';

/**
 * A model-supplied format is only a hypothesis. Once a binding has been
 * matched to a completed-example cell, the cell's rendered shape is the
 * stronger contract. Reconcile incompatible formats before execution so a
 * text value cannot reach the numeric formatter (and vice versa).
 */
function reconcileExampleFormat(expected: string, current?: ReportFormat): ReportFormat | undefined {
  const inferred = formatFromExampleText(expected);
  if (current === undefined) return inferred;
  if (inferred === undefined) {
    // Unknown prose is safe to treat as text only when the model selected a
    // numeric/date style. Date-like prose such as "2026년 8월" is deliberately
    // left alone because it is a valid human date representation that the
    // compact parser cannot classify.
    const normalized = normalizeReportText(expected);
    const dateLike = /(?:^|\D)\d{4}\D+\d{1,2}(?:\D+\d{1,2})?(?:$|\D)/u.test(normalized);
    if (current.style === 'text' || (current.style === 'date' && dateLike)) return current;
    return { style: 'text' };
  }
  const exampleAffix = inferred.prefix !== undefined || inferred.suffix !== undefined;
  if (current.style === inferred.style) {
    // The unit around a number ("174건") is the example's presentation: keep the model's
    // precision but write the unit the example writes.
    return exampleAffix && current.prefix === undefined && current.suffix === undefined
      ? { ...current, ...(inferred.prefix !== undefined ? { prefix: inferred.prefix } : {}),
        ...(inferred.suffix !== undefined ? { suffix: inferred.suffix } : {}) }
      : current;
  }
  // A date stays a date; a period word is never read as a unit, so "9월" or "Q3" do not get here.
  if (exampleAffix && current.style === 'date') return current;
  // Keep the model's affixes only where the example writes them ("₩" on "12,623,600" is not in the
  // example); take the numeric family and precision from the example.
  const shown = normalizeReportText(expected);
  return {
    ...inferred,
    ...(current.prefix && shown.startsWith(current.prefix.trim()) ? { prefix: current.prefix } : {}),
    ...(current.suffix && shown.endsWith(current.suffix.trim()) ? { suffix: current.suffix } : {}),
  };
}

/** The completed example is authoritative for presentation style. */
export function inferReportFormats(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
): ReportPlan {
  const scalarExpected = new Map<string, string>();
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  for (const binding of layout.scalarBindings) {
    if (binding.value.kind !== 'scalar' || scalarExpected.has(binding.value.id)) continue;
    const slot = slots.get(binding.slotId);
    if (slot) scalarExpected.set(binding.value.id, slot.exampleText);
  }
  const scalars = plan.scalars.map((scalar) => {
    const expected = scalarExpected.get(scalar.id);
    if (expected === undefined) return scalar;
    const format = reconcileExampleFormat(expected, scalar.format);
    return format && JSON.stringify(format) !== JSON.stringify(scalar.format)
      ? { ...scalar, format }
      : scalar;
  });

  const groups = new Map(pair.tableGroups.map((group) => [group.id, group]));
  const tableExamples = new Map<string, Map<string, string>>();
  for (const binding of layout.tableBindings) {
    const group = groups.get(binding.groupId);
    if (!group || group.rows.length === 0) continue;
    const row = group.rows[0]!;
    const examples = tableExamples.get(binding.tableId) ?? new Map<string, string>();
    for (const column of binding.columns) {
      const expected = row.cells[column.columnIndex]?.exampleText;
      if (expected !== undefined && !examples.has(column.columnId)) examples.set(column.columnId, expected);
    }
    tableExamples.set(binding.tableId, examples);
  }
  const tables = plan.tables.map((table) => {
    if (table.kind !== 'aggregate') return table;
    const examples = tableExamples.get(table.id);
    if (!examples) return table;
    return {
      ...table,
      columns: table.columns.map((column) => {
        const expected = examples.get(column.id);
        if (expected === undefined) return column;
        const format = reconcileExampleFormat(expected, column.format);
        return format && JSON.stringify(format) !== JSON.stringify(column.format)
          ? { ...column, format }
          : column;
      }),
    };
  });
  return { ...plan, scalars, tables };
}

/**
 * A date-range slot is unambiguous when its completed-example text equals the
 * host's periodStart/periodEndInclusive pair. Repair only the common model
 * mistake of using periodYearMonth for the first half of an otherwise valid
 * range; the values remain metadata-driven for every future period.
 */
export function repairExamplePeriodExpressions(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
  pair: PdfReportPairAnalysis,
  metadata: Record<string, ReportPrimitive>,
): ReportPlan {
  const start = metadata.periodStart;
  const end = metadata.periodEndInclusive;
  if (typeof start !== 'string' || typeof end !== 'string') return plan;
  const expected = normalizeReportText(`${start} ~ ${end}`);
  const slots = new Map(pair.scalarSlots.map((slot) => [slot.id, slot]));
  const periodScalarIds = new Set(
    layout.scalarBindings
      .filter((binding) => binding.value.kind === 'scalar')
      .filter((binding) => normalizeReportText(slots.get(binding.slotId)?.exampleText ?? '') === expected)
      .map((binding) => binding.value.kind === 'scalar' ? binding.value.id : ''),
  );
  const periodTextIds = new Set(
    layout.scalarBindings
      .filter((binding) => binding.value.kind === 'text')
      .filter((binding) => normalizeReportText(slots.get(binding.slotId)?.exampleText ?? '') === expected)
      .map((binding) => binding.value.kind === 'text' ? binding.value.id : ''),
  );
  if (periodScalarIds.size === 0 && periodTextIds.size === 0) return plan;

  const scalars = plan.scalars.map((scalar) => {
    if (!periodScalarIds.has(scalar.id) || scalar.expression.kind !== 'concat') return scalar;
    let hasEnd = false;
    let hasExclusiveEnd = false;
    let replaced = false;
    const values = scalar.expression.values.map((value) => {
      if (value.kind === 'field' && value.path === 'meta.periodEndInclusive') hasEnd = true;
      if (value.kind === 'field' && value.path === 'meta.periodEndExclusive') {
        hasExclusiveEnd = true;
        replaced = true;
        return { kind: 'field' as const, path: 'meta.periodEndInclusive' };
      }
      if (value.kind === 'field' && value.path === 'meta.periodYearMonth') {
        replaced = true;
        return { kind: 'field' as const, path: 'meta.periodStart' };
      }
      return value;
    });
    return (hasEnd || hasExclusiveEnd) && replaced
      ? { ...scalar, expression: { ...scalar.expression, values } } : scalar;
  });
  const texts = plan.texts.map((text) => {
    if (!periodTextIds.has(text.id) || text.kind !== 'computed') return text;
    const tokenOnly = /^\{\{\s*meta\.(?:periodLabel|periodYearMonth|periodTitleKorean)\s*\}\}$/u.test(text.template.trim());
    if (tokenOnly) return { ...text, template: '{{meta.periodStart}} ~ {{meta.periodEndInclusive}}' };
    return /\{\{\s*meta\.periodEndExclusive\s*\}\}/u.test(text.template)
      ? { ...text, template: text.template.replace(/\{\{\s*meta\.periodEndExclusive\s*\}\}/gu, '{{meta.periodEndInclusive}}') }
      : text;
  });
  return { ...plan, scalars, texts };
}
