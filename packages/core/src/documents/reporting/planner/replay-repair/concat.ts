import type {
  ReportAggregateExpression,
  ReportDerivedExpression,
  ReportPlan,
  ReportScalarExpression,
  ReportValueExpression,
} from '../../plan/schema.js';
import { valueAtPath } from '../../plan/value.js';
import { normalizeReportText } from '../../plan/reusability.js';
import { type ReplayRepairInput, type ReplayRepairResult, tableSourceAliases } from './shared.js';
import {
  structuralConcatSuffix,
  structuralConcatExtra,
  structuralConcatGap,
  appendConcatSuffix,
  removeConcatTrailingLiteral,
  insertConcatGap,
} from './concat-shape.js';

type ReplayConcatTarget =
  | { kind: 'scalar'; scalarId: string; mismatches: Array<{ expected: string; actual: string }> }
  | { kind: 'table'; tableId: string; columnId: string; mismatches: Array<{ expected: string; actual: string }> };

function replayConcatTargets(input: ReplayRepairInput, current: ReplayRepairResult): ReplayConcatTarget[] {
  const scalarBindings = new Map(input.layout.scalarBindings.map((binding) => [binding.slotId, binding.value]));
  const scalarTargets = new Map<string, Array<{ expected: string; actual: string }>>();
  const tableTargets = new Map<string, Array<{ expected: string; actual: string }>>();
  const groups = new Map(input.pair.tableGroups.map((group) => [group.id, group]));

  for (const mismatch of current.mismatches) {
    const scalarValue = scalarBindings.get(mismatch.slotId);
    if (scalarValue?.kind === 'scalar') {
      const mismatches = scalarTargets.get(scalarValue.id) ?? [];
      mismatches.push({ expected: mismatch.expected, actual: mismatch.actual });
      scalarTargets.set(scalarValue.id, mismatches);
      continue;
    }
    for (const binding of input.layout.tableBindings) {
      const group = groups.get(binding.groupId);
      if (!group) continue;
      const column = binding.columns.find((candidate) => group.rows.some((row) => (
        row.cells[candidate.columnIndex]?.id === mismatch.slotId
      )));
      if (!column) continue;
      const key = `${binding.tableId}\u0000${column.columnId}`;
      const mismatches = tableTargets.get(key) ?? [];
      mismatches.push({ expected: mismatch.expected, actual: mismatch.actual });
      tableTargets.set(key, mismatches);
      break;
    }
  }

  return [
    ...[...scalarTargets].map(([scalarId, mismatches]) => ({ kind: 'scalar' as const, scalarId, mismatches })),
    ...[...tableTargets].map(([key, mismatches]) => {
      const separator = key.indexOf('\u0000');
      return { kind: 'table' as const, tableId: key.slice(0, separator), columnId: key.slice(separator + 1), mismatches };
    }),
  ];
}

function rewriteConcatTarget(
  plan: ReportPlan,
  target: ReplayConcatTarget,
  token: string,
  rewrite: (value: unknown, token: string) => { value: unknown; changed: boolean },
): ReportPlan {
  if (target.kind === 'scalar') {
    return {
      ...plan,
      scalars: plan.scalars.map((scalar) => scalar.id === target.scalarId
        ? { ...scalar, expression: rewrite(scalar.expression, token).value as ReportScalarExpression }
        : scalar),
    };
  }
  return {
    ...plan,
    tables: plan.tables.map((table) => {
      if (table.kind !== 'aggregate' || table.id !== target.tableId) return table;
      const groupBy = table.groupBy.map((group) => (
        group.id === target.columnId
          ? { ...group, value: rewrite(group.value, token).value as ReportValueExpression }
          : group
      ));
      const columns = table.columns.map((column) => {
        if (column.id !== target.columnId || column.value.kind === 'group_key') return column;
        if (column.value.kind === 'aggregate') {
          return { ...column, value: {
            ...column.value,
            expression: rewrite(column.value.expression, token).value as ReportAggregateExpression,
          } };
        }
        return { ...column, value: {
          ...column.value,
          expression: rewrite(column.value.expression, token).value as ReportDerivedExpression,
        } };
      });
      return { ...table, columns, groupBy };
    }),
  };
}

function identityFieldPath(path: string): boolean {
  const field = path.split('.').at(-1) ?? '';
  return /^(?:id|code|no|number|uuid|.+_(?:id|code|no|number|uuid))$/iu.test(field);
}

function missingConcatFieldShape(
  expected: string,
  actual: string,
  candidateValues: ReadonlySet<string>,
): { prefix: string; suffix: string } | undefined {
  const expectedText = normalizeReportText(expected);
  const actualText = normalizeReportText(actual);
  if (!expectedText.startsWith(actualText) || expectedText === actualText) return undefined;
  const tail = expectedText.slice(actualText.length);
  const matches = [...candidateValues]
    .filter((value) => value && tail.includes(value))
    .sort((left, right) => right.length - left.length || left.localeCompare(right));
  const value = matches[0];
  if (!value || (matches[1] && matches[1] === value)) return undefined;
  const index = tail.indexOf(value);
  if (index < 0) return undefined;
  const prefix = tail.slice(0, index);
  const suffix = tail.slice(index + value.length);
  if (/[p{L}\p{N}]/u.test(prefix) || /[p{L}\p{N}]/u.test(suffix)) return undefined;
  return { prefix, suffix };
}

function missingConcatFieldCandidates(
  input: ReplayRepairInput,
  table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>,
  base: ReportValueExpression,
): string[] {
  const basePath = base.kind === 'field' ? base.path : '';
  const baseAlias = basePath.split('.')[0] ?? '';
  const baseField = basePath.split('.').at(-1) ?? '';
  const relatedField = baseField.replace(/(?:_name|_label|_title)$/iu, '_id');
  const aliases = tableSourceAliases(input.plan, table);
  const candidates: string[] = [];
  for (const alias of aliases) {
    const snapshot = input.sources[alias];
    if (!snapshot) continue;
    for (const field of new Set(snapshot.rows.flatMap((row) => Object.keys(row)))) {
      const path = `${alias}.${field}`;
      if (path === basePath || !identityFieldPath(path)) continue;
      candidates.push(path);
    }
  }
  return [...new Set(candidates)].sort((left, right) => {
    const score = (path: string): number => {
      const alias = path.split('.')[0] ?? '';
      const field = path.split('.').at(-1) ?? '';
      return Number(alias === baseAlias) * 100 + Number(field === relatedField) * 50
        + Number(field === `${baseField.replace(/_name$/iu, '')}_id`) * 25;
    };
    return score(right) - score(left) || left.localeCompare(right);
  }).slice(0, 24);
}

function missingConcatFieldExpression(
  base: ReportValueExpression,
  path: string,
  prefix: string,
  suffix: string,
): ReportValueExpression {
  const combined: ReportValueExpression = {
    kind: 'concat',
    values: [base, { kind: 'field', path }],
    separator: prefix,
  };
  return suffix
    ? { kind: 'concat', values: [combined, { kind: 'literal', value: suffix }], separator: '' }
    : combined;
}

function rewriteMissingConcatFieldTarget(
  plan: ReportPlan,
  tableId: string,
  columnId: string,
  expression: ReportValueExpression,
): ReportPlan {
  return {
    ...plan,
    tables: plan.tables.map((table) => {
      if (table.kind !== 'aggregate' || table.id !== tableId) return table;
      const groupBy = table.groupBy.map((group) => group.id === columnId ? { ...group, value: expression } : group);
      return groupBy.some((group, index) => group !== table.groupBy[index]) ? { ...table, groupBy } : table;
    }),
  };
}

/**
 * Recover a dynamic identifier that the model dropped from a grouped label,
 * for example `customer_name` rendered as `customer_name (customer_id)`.
 * The suffix must contain a captured identity-field value for every mismatched
 * row and use one consistent punctuation shape; no example value is written
 * into the plan. Replay remains the final oracle for accepting a candidate.
 */
export function applyMissingConcatFieldVariants(
  input: ReplayRepairInput,
  current: ReplayRepairResult,
): ReplayRepairInput[] {
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const target of replayConcatTargets(input, current)) {
    if (target.kind !== 'table') continue;
    const table = input.plan.tables.find((candidate): candidate is Extract<ReportPlan['tables'][number], { kind: 'aggregate' }> => (
      candidate.kind === 'aggregate' && candidate.id === target.tableId
    ));
    const group = table?.groupBy.find((candidate) => candidate.id === target.columnId);
    if (!table || !group || group.value.kind === 'concat') continue;
    const base = group.value;
    const paths = missingConcatFieldCandidates(input, table, base);
    for (const path of paths) {
      const snapshot = input.sources[path.split('.')[0]!];
      const field = path.split('.').slice(1).join('.');
      if (!snapshot || !field) continue;
      const values = new Set(snapshot.rows.map((row) => normalizeReportText(String(valueAtPath(row, field) ?? ''))).filter(Boolean));
      let shape: { prefix: string; suffix: string } | undefined;
      for (const mismatch of target.mismatches) {
        const candidateShape = missingConcatFieldShape(mismatch.expected, mismatch.actual, values);
        if (!candidateShape) { shape = undefined; break; }
        if (shape && (shape.prefix !== candidateShape.prefix || shape.suffix !== candidateShape.suffix)) {
          shape = undefined;
          break;
        }
        shape ??= candidateShape;
      }
      if (!shape) continue;
      const expression = missingConcatFieldExpression(base, path, shape.prefix, shape.suffix);
      const plan = rewriteMissingConcatFieldTarget(input.plan, table.id, target.columnId, expression);
      const key = JSON.stringify(plan);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ ...input, plan });
      if (variants.length >= 48) return variants;
    }
  }
  return variants;
}

export function applyConcatRepairVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const target of replayConcatTargets(input, current)) {
    const repairs = target.mismatches.flatMap((mismatch) => {
      const suffix = structuralConcatSuffix(mismatch.expected, mismatch.actual);
      const extra = structuralConcatExtra(mismatch.expected, mismatch.actual);
      const gap = structuralConcatGap(mismatch.expected, mismatch.actual);
      return [
        ...(suffix ? [{ token: suffix, rewrite: appendConcatSuffix }] : []),
        ...(extra ? [{ token: extra, rewrite: removeConcatTrailingLiteral }] : []),
        ...(gap ? [{ token: gap, rewrite: insertConcatGap }] : []),
      ];
    });
    for (const repair of repairs) {
      const plan = rewriteConcatTarget(input.plan, target, repair.token, repair.rewrite);
      if (JSON.stringify(plan) === JSON.stringify(input.plan)) continue;
      const key = JSON.stringify(plan);
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push({ ...input, plan });
    }
  }
  return variants;
}
