import type { ReportPlan } from '../../plan/schema.js';
import { mismatchedReplayTargets, type ReplayRepairInput, type ReplayRepairResult } from './shared.js';

function signedNumber(text: string): number | undefined {
  const digits = text.replace(/[^\d.-]/gu, '');
  if (!/\d/u.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) ? value : undefined;
}

/** Every way of turning exactly one subtraction around inside an expression tree. */
function flips(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flips(item).map((flipped) => value.map((other, at) => (at === index ? flipped : other))));
  }
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const own = record.kind === 'arithmetic' && record.operation === 'subtract'
    ? [{ ...record, left: record.right, right: record.left }] : [];
  const nested = Object.entries(record).flatMap(([key, child]) => flips(child).map((flipped) => ({ ...record, [key]: flipped })));
  return [...own, ...nested];
}

/**
 * The example shows -371 where the plan gives 371: the subtraction runs the wrong way round
 * (출고 − 입고 for 입고 − 출고). Turn one subtraction of a wrong value around; the replay keeps it
 * only when it gets strictly better.
 */
export function applySubtractionOrderVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const negated = current.mismatches.filter((mismatch) => {
    const expected = signedNumber(mismatch.expected);
    const actual = signedNumber(mismatch.actual);
    return expected !== undefined && actual !== undefined && expected !== 0 && expected === -actual;
  });
  if (negated.length === 0) return [];
  const targets = mismatchedReplayTargets(input.pair, input.layout, negated);
  const variants: ReplayRepairInput[] = [];
  for (const scalar of input.plan.scalars) {
    if (!targets.scalarIds.has(scalar.id)) continue;
    for (const expression of flips(scalar.expression)) {
      variants.push({ ...input, plan: { ...input.plan,
        scalars: input.plan.scalars.map((item) => (item === scalar ? { ...item, expression } as typeof item : item)) } });
    }
  }
  for (const table of input.plan.tables) {
    const columns = targets.tableColumns.get(table.id);
    if (table.kind !== 'aggregate' || !columns) continue;
    for (const column of table.columns) {
      if (!columns.has(column.id) || !('expression' in column.value)) continue;
      for (const expression of flips(column.value.expression)) {
        const tables: ReportPlan['tables'] = input.plan.tables.map((item) => (item !== table ? item : {
          ...table,
          columns: table.columns.map((other) => (other === column ? { ...column, value: { ...column.value, expression } } as typeof column : other)),
        }));
        variants.push({ ...input, plan: { ...input.plan, tables } });
      }
    }
  }
  return variants;
}
