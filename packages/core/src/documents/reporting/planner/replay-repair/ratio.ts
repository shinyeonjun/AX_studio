import type {
  ReportAggregateExpression,
  ReportPlan,
  ReportPredicate,
  ReportSourceSnapshot,
  ReportValueExpression,
} from '../../plan/schema.js';
import { isRecordValue } from '../../plan/value.js';
import {
  formatFromExampleText,
  type ReplayRepairInput,
  type ReplayRepairResult,
  numericEvidenceValue,
  mismatchedReplayTargets,
  withAggregateFilter,
} from './shared.js';
import { replayPredicateCandidates } from './predicates.js';

function simpleRatio(value: unknown): { left: unknown; right: unknown } | undefined {
  if (!isRecordValue(value) || value.kind !== 'arithmetic' || value.operation !== 'divide') return undefined;
  if (!isRecordValue(value.left) || !isRecordValue(value.right)) return undefined;
  if (!['sum', 'sum_distinct'].includes(String(value.left.kind))) return undefined;
  const denominatorHasAggregate = (candidate: unknown): boolean => (
    isRecordValue(candidate) && (
      ['sum', 'sum_distinct'].includes(String(candidate.kind))
      || (candidate.kind === 'arithmetic'
        && denominatorHasAggregate(candidate.left)
        && denominatorHasAggregate(candidate.right))
    )
  );
  if (!denominatorHasAggregate(value.right)) return undefined;
  return { left: value.left, right: value.right };
}

function ratioSignature(value: unknown): string | undefined {
  const ratio = simpleRatio(value);
  return ratio ? JSON.stringify(ratio.left) : undefined;
}

function rewriteRatios(
  value: unknown,
  signatures: ReadonlySet<string>,
  denominator: ReportAggregateExpression,
  filter?: ReportPredicate,
): unknown {
  if (Array.isArray(value)) return value.map((item) => rewriteRatios(item, signatures, denominator, filter));
  if (!isRecordValue(value)) return value;
  const ratio = simpleRatio(value);
  if (ratio && signatures.has(JSON.stringify(ratio.left))) {
    return {
      ...value,
      ...(filter ? { left: withAggregateFilter(ratio.left as ReportAggregateExpression, filter) } : {}),
      right: filter ? withAggregateFilter(denominator, filter) : denominator,
    };
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, rewriteRatios(child, signatures, denominator, filter),
  ]));
}

function numericSourceFields(sources: Record<string, ReportSourceSnapshot>, preferred: string[] = []): string[] {
  const counts = new Map<string, number>();
  for (const [alias, snapshot] of Object.entries(sources)) {
    for (const row of snapshot.rows) {
      for (const [field, value] of Object.entries(row)) {
        if (numericEvidenceValue(value) === undefined) continue;
        const path = `${alias}.${field}`;
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }
    }
  }
  const preferredSet = new Set(preferred);
  return [...counts.keys()].sort((left, right) => (
    Number(preferredSet.has(right)) - Number(preferredSet.has(left)) || left.localeCompare(right)
  )).slice(0, 16);
}

function ratioDenominatorCandidates(
  sources: Record<string, ReportSourceSnapshot>,
  current: unknown,
): ReportAggregateExpression[] {
  const preferred: string[] = [];
  const collectFields = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(collectFields);
    if (!isRecordValue(value)) return;
    if (value.kind === 'field' && typeof value.path === 'string') preferred.push(value.path);
    Object.values(value).forEach(collectFields);
  };
  collectFields(current);
  const fields = numericSourceFields(sources, preferred);
  const semanticFields = fields.filter((path) => /(?:net|refund|gross|discount|sales|revenue|amount|total)/iu.test(path));
  const orderedFields = [...new Set([...semanticFields, ...fields])];
  const values: ReportAggregateExpression[] = [];
  const seen = new Set<string>();
  const add = (expression: ReportAggregateExpression): void => {
    const key = JSON.stringify(expression);
    if (!seen.has(key)) {
      seen.add(key);
      values.push(expression);
    }
  };
  const sum = (value: ReportValueExpression): ReportAggregateExpression => ({ kind: 'sum', value });
  const field = (path: string): ReportValueExpression => ({ kind: 'field', path });
  const findSemanticField = (pattern: RegExp): string | undefined => orderedFields.find((path) => pattern.test(path));
  const net = findSemanticField(/(?:^|[_.])net(?:_|$)/iu);
  const refund = findSemanticField(/(?:^|[_.])refund(?:_|$)/iu);
  const gross = findSemanticField(/(?:^|[_.])gross(?:_|$)/iu);
  const discount = findSemanticField(/(?:^|[_.])discount(?:_|$)/iu);
  // Common financial identities are tried before the broad numeric search.
  // This prevents a large source catalog from consuming the bounded ratio
  // candidate budget before the business formula can be replayed.
  if (net && refund) {
    add(sum({ kind: 'arithmetic', operation: 'add', left: field(net), right: field(refund) }));
  }
  if (gross && discount) {
    add(sum({ kind: 'arithmetic', operation: 'subtract', left: field(gross), right: field(discount) }));
  }
  const addPairs = (paths: string[]): void => {
    for (let left = 0; left < paths.length; left += 1) {
      for (let right = left + 1; right < paths.length; right += 1) {
        add(sum({ kind: 'arithmetic', operation: 'subtract', left: field(paths[left]!), right: field(paths[right]!) }));
        add(sum({ kind: 'arithmetic', operation: 'subtract', left: field(paths[right]!), right: field(paths[left]!) }));
        add(sum({ kind: 'arithmetic', operation: 'add', left: field(paths[left]!), right: field(paths[right]!) }));
      }
    }
  };
  addPairs(semanticFields);
  addPairs(orderedFields);
  for (const path of fields) add(sum(field(path)));
  return values;
}

export function applyRatioRepairVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  const signatures = new Set<string>();
  for (const scalar of input.plan.scalars) {
    if (!targets.scalarIds.has(scalar.id)) continue;
    const signature = ratioSignature(scalar.expression);
    if (signature) signatures.add(signature);
  }
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate') continue;
    const columns = targets.tableColumns.get(table.id);
    if (!columns) continue;
    for (const column of table.columns) {
      if (!columns.has(column.id) || column.value.kind !== 'derived') continue;
      const signature = ratioSignature(column.value.expression);
      if (signature) signatures.add(signature);
    }
  }
  if (signatures.size === 0) return [];
  const variants: ReplayRepairInput[] = [];
  const existing = new Set<string>();
  const filters = replayPredicateCandidates(input.plan);
  for (const denominator of ratioDenominatorCandidates(input.sources, input.plan)) {
    for (const filter of filters) {
      const plan = rewriteRatios(input.plan, signatures, denominator, filter) as ReportPlan;
      const key = JSON.stringify(plan);
      if (existing.has(key)) continue;
      existing.add(key);
      variants.push({ ...input, plan });
      if (variants.length >= 96) return variants;
    }
  }
  return variants;
}

function ratioAggregateCandidates(
  table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>,
): Array<{ numerator: ReportAggregateExpression; denominator: ReportAggregateExpression; numeratorId: string; denominatorId: string }> {
  const aggregateColumns = table.columns.flatMap((column) => (
    column.value.kind === 'aggregate'
      ? [{ id: column.id, expression: column.value.expression }]
      : []
  ));
  const numerators = aggregateColumns.filter(({ expression }) => (
    ['sum', 'sum_distinct', 'average'].includes(expression.kind)
  ));
  const denominators = aggregateColumns.filter(({ expression }) => (
    ['sum', 'sum_distinct', 'first', 'average'].includes(expression.kind)
  ));
  const candidates: Array<{ numerator: ReportAggregateExpression; denominator: ReportAggregateExpression; numeratorId: string; denominatorId: string }> = [];
  for (const numerator of numerators) {
    for (const denominator of denominators) {
      if (numerator.id === denominator.id) continue;
      let denominatorExpression = denominator.expression;
      if (denominatorExpression.kind === 'first' && table.groupBy.length > 0) {
        denominatorExpression = {
          kind: 'sum_distinct',
          value: denominatorExpression.value,
          distinctBy: table.groupBy[0]!.value,
          ...(denominatorExpression.where ? { where: denominatorExpression.where } : {}),
        };
      }
      candidates.push({
        numerator: withAggregateFilter(numerator.expression, table.filter),
        denominator: withAggregateFilter(denominatorExpression, table.filter),
        numeratorId: numerator.id,
        denominatorId: denominator.id,
      });
    }
  }
  return candidates;
}

export function applyMissingScalarMetricVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const scalarBindings = new Map(input.layout.scalarBindings.map((binding) => [binding.slotId, binding.value]));
  const mismatchedScalars = current.mismatches.flatMap((mismatch) => {
    const value = scalarBindings.get(mismatch.slotId);
    return value?.kind === 'scalar' ? [{ ...mismatch, scalarId: value.id }] : [];
  });
  if (mismatchedScalars.length === 0) return [];

  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const mismatch of mismatchedScalars) {
    const format = formatFromExampleText(mismatch.expected);
    for (const table of input.plan.tables) {
      if (table.kind !== 'aggregate') continue;
      for (const candidate of ratioAggregateCandidates(table)) {
        let id = `${mismatch.scalarId}-from-${table.id}-${candidate.numeratorId}-over-${candidate.denominatorId}`
          .replace(/[^a-zA-Z0-9_-]+/gu, '_');
        const existingIds = new Set(input.plan.scalars.map((scalar) => scalar.id));
        let suffix = 2;
        while (existingIds.has(id)) id = `${mismatch.scalarId}-derived-${suffix++}`;
        const plan: ReportPlan = {
          ...input.plan,
          scalars: [...input.plan.scalars, {
            id,
            expression: { kind: 'arithmetic', operation: 'divide', left: candidate.numerator, right: candidate.denominator },
            ...(format ? { format } : {}),
          }],
        };
        const layout = {
          ...input.layout,
          scalarBindings: input.layout.scalarBindings.map((binding) => (
            binding.slotId === mismatch.slotId
              ? { ...binding, value: { kind: 'scalar' as const, id } }
              : binding
          )),
        };
        const key = JSON.stringify({ plan, layout });
        if (seen.has(key)) continue;
        seen.add(key);
        variants.push({ ...input, plan, layout });
        if (variants.length >= 48) return variants;
      }
    }
  }
  return variants;
}

export function applyDerivedTableRatioVariants(
  input: ReplayRepairInput,
  current: ReplayRepairResult,
): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  const filters = replayPredicateCandidates(input.plan);
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate' || !targets.tableIds.has(table.id)) continue;
    const badColumns = targets.tableColumns.get(table.id);
    if (!badColumns) continue;
    for (const column of table.columns) {
      if (!badColumns.has(column.id) || column.value.kind !== 'derived') continue;
      const expression = column.value.expression;
      if (!isRecordValue(expression) || expression.kind !== 'arithmetic' || expression.operation !== 'divide'
        || !isRecordValue(expression.left) || expression.left.kind !== 'column'
        || !isRecordValue(expression.right) || expression.right.kind !== 'column') continue;
      const numeratorId = typeof expression.left.columnId === 'string' ? expression.left.columnId : undefined;
      const denominatorId = typeof expression.right.columnId === 'string' ? expression.right.columnId : undefined;
      const numerator = table.columns.find((candidate) => candidate.id === numeratorId);
      const denominator = table.columns.find((candidate) => candidate.id === denominatorId);
      if (!numerator || numerator.value.kind !== 'aggregate' || !denominator || denominator.value.kind !== 'aggregate') continue;
      for (const candidate of ratioDenominatorCandidates(input.sources, {
        numerator: numerator.value.expression,
        denominator: denominator.value.expression,
      })) {
        for (const filter of filters) {
          const nextTable = {
            ...table,
            columns: table.columns.map((candidateColumn) => {
              if (candidateColumn.id === numerator.id && candidateColumn.value.kind === 'aggregate') {
                return { ...candidateColumn, value: { ...candidateColumn.value,
                  expression: filter ? withAggregateFilter(candidateColumn.value.expression, filter) : candidateColumn.value.expression } };
              }
              if (candidateColumn.id === denominator.id && candidateColumn.value.kind === 'aggregate') {
                return { ...candidateColumn, value: { ...candidateColumn.value,
                  expression: filter ? withAggregateFilter(candidate, filter) : candidate } };
              }
              return candidateColumn;
            }),
          };
          const plan = { ...input.plan, tables: input.plan.tables.map((candidateTable) => candidateTable.id === table.id ? nextTable : candidateTable) };
          const key = JSON.stringify(plan);
          if (seen.has(key)) continue;
          seen.add(key);
          variants.push({ ...input, plan });
          if (variants.length >= 96) return variants;
        }
      }
    }
  }
  return variants;
}
