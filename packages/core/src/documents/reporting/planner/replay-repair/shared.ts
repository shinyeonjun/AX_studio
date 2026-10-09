import type { PdfReportPairAnalysis } from '../../../read/types/pdf.js';
import type { ReportLayoutPlan } from '../../layout/schema.js';
import type {
  ReportAggregateExpression,
  ReportFormat,
  ReportPlan,
  ReportPredicate,
  ReportPrimitive,
  ReportSourceSnapshot,
} from '../../plan/schema.js';
import { isRecordValue } from '../../plan/value.js';
import { normalizeReportText } from '../../plan/reusability.js';

export function formatFromExampleText(value: string): ReportFormat | undefined {
  const text = normalizeReportText(value);
  const numericPattern = '[+-]?(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?';
  if (new RegExp(`^KRW\\s*${numericPattern}$`, 'iu').test(text)) {
    return { style: 'currency', currency: 'KRW', decimals: text.includes('.') ? text.split('.').at(-1)!.length : 0 };
  }
  if (new RegExp(`^(?:₩|\\$|€|£)\\s*${numericPattern}$`, 'u').test(text)) {
    const decimals = text.includes('.') ? text.split('.').at(-1)!.length : 0;
    const currency = text.trimStart().at(0) === '₩' ? 'KRW' : undefined;
    return { style: 'currency', ...(currency ? { currency } : {}), decimals };
  }
  if (new RegExp(`^${numericPattern}\\s*(?:원|KRW)$`, 'iu').test(text)) {
    const numeric = text.replace(/(?:원|KRW)$/iu, '').trim();
    const decimals = numeric.includes('.') ? numeric.split('.').at(-1)!.length : 0;
    return { style: 'currency', currency: 'KRW', decimals };
  }
  if (new RegExp(`^${numericPattern}\\s*%$`, 'u').test(text)) {
    const numeric = text.slice(0, -1).replace(/,/g, '').trim();
    const decimals = numeric.includes('.') ? numeric.split('.').at(-1)!.length : 0;
    return { style: 'percent', decimals };
  }
  // A count or amount with the report's own unit around it: "174건", "8곳", "약 3회", "No. 12".
  const unit = new RegExp(`^(\\D{0,6}?)(${numericPattern})(\\D{0,6})$`, 'u').exec(text);
  // Not a period: "9월", "2분기", "Q3", "FY26" name a point in the calendar, they are not counted.
  // A duration ("28.5분", "3시간") is an amount, and a decimal is never a calendar point.
  const period = !(unit?.[2] ?? '').includes('.') && (/^\s*(?:년|월|일|주|분기|반기|차|기)/u.test(unit?.[3] ?? '')
    || /(?:^|\s)(?:Q|H|FY|W)\s*$/iu.test(unit?.[1] ?? ''));
  if (unit && !period && !/\d/u.test(unit[1]! + unit[3]!)) {
    const numeric = unit[2]!;
    return {
      style: numeric.includes('.') ? 'decimal' : 'integer',
      ...(numeric.includes('.') ? { decimals: numeric.split('.').at(-1)!.length } : {}),
      ...(unit[1] ? { prefix: unit[1] } : {}),
      ...(unit[3] ? { suffix: unit[3] } : {}),
    };
  }
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return { style: 'date' };
  return undefined;
}

export interface ReplayRepairInput {
  plan: ReportPlan;
  layout: ReportLayoutPlan;
  pair: PdfReportPairAnalysis;
  sources: Record<string, ReportSourceSnapshot>;
  metadata: Record<string, ReportPrimitive>;
}

export interface ReplayRepairResult {
  plan: ReportPlan;
  layout: ReportLayoutPlan;
  mismatches: Array<{ slotId: string; expected: string; actual: string }>;
  /** Set only for the initial plan when replay could not be executed. */
  executionError?: string;
}

export function numericEvidenceValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/,/gu, '').trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function mismatchedReplayTargets(
  pair: PdfReportPairAnalysis,
  layout: ReportLayoutPlan,
  mismatches: Array<{ slotId: string; expected: string; actual: string }>,
): { scalarIds: Set<string>; tableColumns: Map<string, Set<string>>; tableIds: Set<string> } {
  const badSlots = new Set(mismatches.map((mismatch) => mismatch.slotId));
  const scalarIds = new Set<string>();
  for (const binding of layout.scalarBindings) {
    if (badSlots.has(binding.slotId) && binding.value.kind === 'scalar') scalarIds.add(binding.value.id);
  }
  const groups = new Map(pair.tableGroups.map((group) => [group.id, group]));
  const tableColumns = new Map<string, Set<string>>();
  const tableIds = new Set<string>();
  for (const binding of layout.tableBindings) {
    const group = groups.get(binding.groupId);
    if (!group) continue;
    for (const column of binding.columns) {
      if (!group.rows.some((row) => badSlots.has(row.cells[column.columnIndex]?.id ?? ''))) continue;
      const columns = tableColumns.get(binding.tableId) ?? new Set<string>();
      columns.add(column.columnId);
      tableColumns.set(binding.tableId, columns);
      tableIds.add(binding.tableId);
    }
  }
  return { scalarIds, tableColumns, tableIds };
}

export function withAggregateFilter(
  expression: ReportAggregateExpression,
  filter: ReportPredicate | undefined,
): ReportAggregateExpression {
  if (!filter || expression.kind === 'arithmetic') return expression;
  const current = expression.where;
  return {
    ...expression,
    where: current ? { kind: 'and', items: [current, filter] } : filter,
  };
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecordValue(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function tableSourceAliases(plan: ReportPlan, table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): string[] {
  const dataset = table.dataset ? plan.datasets?.find((candidate) => candidate.id === table.dataset) : undefined;
  const baseSource = dataset?.baseSource ?? plan.baseSource;
  const joins = dataset?.joins ?? plan.joins;
  return [...new Set([baseSource, ...joins.map((join) => join.source)])];
}

export function aggregateColumnReferences(value: unknown): Set<string> {
  const references = new Set<string>();
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) return candidate.forEach(visit);
    if (!isRecordValue(candidate)) return;
    if (candidate.kind === 'column' && typeof candidate.columnId === 'string') {
      references.add(candidate.columnId);
    }
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return references;
}
