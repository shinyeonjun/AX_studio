import type { ReportPlan, ReportPredicate } from '../../plan/schema.js';
import { fieldPaths, isRecordValue } from '../../plan/value.js';
import {
  type ReplayRepairInput,
  type ReplayRepairResult,
  mismatchedReplayTargets,
  stableJson,
} from './shared.js';
import { predicateSpecificity } from './predicates.js';
import {
  structuralConcatSuffix,
  structuralConcatExtra,
  structuralConcatGap,
} from './concat-shape.js';

function datasetDefinition(plan: ReportPlan, id: string | undefined): unknown {
  if (!id) return { baseSource: plan.baseSource, joins: plan.joins, filter: plan.filter };
  const dataset = plan.datasets?.find((candidate) => candidate.id === id);
  if (!dataset) return undefined;
  const { id: _id, ...definition } = dataset;
  return definition;
}

function sameDatasetDefinition(plan: ReportPlan, left: string | undefined, right: string | undefined): boolean {
  return stableJson(datasetDefinition(plan, left)) === stableJson(datasetDefinition(plan, right));
}

function havingOperatorVariant(value: unknown, from: 'and' | 'or', to: 'and' | 'or'): unknown {
  if (Array.isArray(value)) return value.map((item) => havingOperatorVariant(item, from, to));
  if (!isRecordValue(value)) return value;
  const next = Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key, havingOperatorVariant(child, from, to),
  ]));
  return next.kind === from ? { ...next, kind: to } : next;
}

export function applyTableRepairVariants(input: ReplayRepairInput, current: ReplayRepairResult): ReplayRepairInput[] {
  const targets = mismatchedReplayTargets(input.pair, input.layout, current.mismatches);
  if (targets.tableIds.size === 0) return [];
  const variants: ReplayRepairInput[] = [];
  const seen = new Set<string>();
  const addVariant = (plan: ReportPlan): void => {
    const key = JSON.stringify(plan);
    if (seen.has(key)) return;
    seen.add(key);
    variants.push({ ...input, plan });
  };
  const groupFieldPaths = (table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): Set<string> => (
    fieldPaths(table.groupBy)
  );
  const sourceShape = (table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): string => {
    const definition = datasetDefinition(input.plan, table.dataset);
    if (!isRecordValue(definition)) return stableJson(definition);
    const { filter: _filter, ...withoutFilter } = definition;
    return stableJson(withoutFilter);
  };
  const datasetFilter = (table: Extract<ReportPlan['tables'][number], { kind: 'aggregate' }>): ReportPredicate | undefined => {
    const definition = datasetDefinition(input.plan, table.dataset);
    return isRecordValue(definition) && isRecordValue(definition.filter)
      ? definition.filter as ReportPredicate
      : undefined;
  };
  for (const table of input.plan.tables) {
    if (table.kind !== 'aggregate' || !table.limit || !targets.tableIds.has(table.id)) continue;
    const boundSlotIds = new Set(
      input.layout.tableBindings
        .filter((binding) => binding.tableId === table.id)
        .flatMap((binding) => input.pair.tableGroups.find((group) => group.id === binding.groupId)?.rows
          .flatMap((row) => row.cells.map((cell) => cell.id)) ?? []),
    );
    const tableMismatches = current.mismatches.filter((mismatch) => boundSlotIds.has(mismatch.slotId));
    // A delimiter mismatch in a grouped label is a presentation repair, not
    // evidence that the table's filter or top-N rule is wrong. Avoid spending
    // a full sort/filter cross-product on that case; the dedicated concat
    // repair below can fix it in one candidate.
    if (tableMismatches.length > 0
      && tableMismatches.every((mismatch) => (
        structuralConcatSuffix(mismatch.expected, mismatch.actual) !== undefined
        || structuralConcatExtra(mismatch.expected, mismatch.actual) !== undefined
        || structuralConcatGap(mismatch.expected, mismatch.actual) !== undefined
      ))) continue;
    const siblings = input.plan.tables.filter((candidate): candidate is Extract<typeof candidate, { kind: 'aggregate' }> => (
      candidate.kind === 'aggregate' && candidate.id !== table.id
        && sameDatasetDefinition(input.plan, candidate.dataset, table.dataset)
        && (stableJson(candidate.groupBy) === stableJson(table.groupBy)
          || [...groupFieldPaths(candidate)].some((path) => groupFieldPaths(table).has(path)))
    ));
    const filterOptions: Array<typeof table.filter> = [table.filter];
    const addFilterOption = (filter: ReportPredicate | undefined): void => {
      if (filter && !filterOptions.some((candidate) => stableJson(candidate) === stableJson(filter))) {
        filterOptions.push(filter);
      }
    };
    addFilterOption(datasetFilter(table));
    for (const candidate of input.plan.tables) {
      if (candidate.kind !== 'aggregate' || candidate.id === table.id
        || sourceShape(candidate) !== sourceShape(table)) continue;
      // A dataset-level period/status predicate is independent of the output
      // grouping. Collect it before checking grouping overlap so a regional
      // or tier summary can evidence the same row subset for a customer or
      // risk table. Row-level table filters still need an overlapping shape;
      // otherwise a predicate may describe a different business slice.
      addFilterOption(datasetFilter(candidate));
      const overlapsGrouping = stableJson(candidate.groupBy) === stableJson(table.groupBy)
        || [...groupFieldPaths(candidate)].some((path) => groupFieldPaths(table).has(path));
      if (!overlapsGrouping) continue;
      addFilterOption(candidate.filter);
    }
    // Prefer a more specific, already evidenced predicate when the model
    // omitted a dataset filter. This keeps the bounded candidate budget from
    // exhausting itself on the unfiltered/date-only variants before a shared
    // status or eligibility subset is evaluated.
    const filterOrder = new Map(filterOptions.map((filter, index) => [stableJson(filter), index]));
    filterOptions.sort((left, right) => {
      return predicateSpecificity(right) - predicateSpecificity(left)
        || (filterOrder.get(stableJson(left)) ?? 0) - (filterOrder.get(stableJson(right)) ?? 0);
    });
    const extraColumns = siblings.flatMap((sibling) => sibling.columns.filter((column) => (
      column.value.kind !== 'group_key' && !table.columns.some((existing) => existing.id === column.id)
    )));
    const numericColumns = (columns: typeof table.columns): typeof table.columns => columns.filter((column) => column.value.kind !== 'group_key');
    const groupColumns = (columns: typeof table.columns): typeof table.columns => columns.filter((column) => column.value.kind === 'group_key');
    const orderedSortColumns = [...numericColumns(extraColumns), ...numericColumns(table.columns), ...groupColumns(table.columns), ...groupColumns(extraColumns)];
    const candidateColumnIds = [...new Set(orderedSortColumns.map((column) => column.id))];
    const columns = extraColumns.reduce((currentColumns, column) => (
      currentColumns.some((existing) => existing.id === column.id) ? currentColumns : [...currentColumns, column]
    ), [...table.columns]);
    const havingOptions: Array<typeof table.having> = [table.having];
    if (table.having?.kind === 'and' || table.having?.kind === 'or') {
      // A model often preserves every plausible criterion in having even when
      // the example table applies only one of them. Try each observed clause
      // as an independent candidate; replay decides whether it is evidenced.
      havingOptions.push(...table.having.items);
      const opposite = table.having.kind === 'and' ? 'or' : 'and';
      havingOptions.push(havingOperatorVariant(table.having, table.having.kind, opposite) as typeof table.having);
    }
    const sortOptions: NonNullable<typeof table.sort> = [];
    const addSortOption = (sort: NonNullable<typeof table.sort>[number] | undefined): void => {
      if (!sort || !candidateColumnIds.includes(sort.columnId)
        || sortOptions.some((candidate) => candidate.columnId === sort.columnId && candidate.direction === sort.direction)) return;
      sortOptions.push(sort);
    };
    // A sibling's explicit ordering is stronger evidence than a newly guessed
    // metric, especially for a table that hides the metric used for top-N.
    for (const sibling of siblings) for (const sort of sibling.sort ?? []) addSortOption(sort);
    for (const sort of table.sort ?? []) addSortOption(sort);
    for (const columnId of candidateColumnIds) {
      addSortOption({ columnId, direction: 'asc' });
      addSortOption({ columnId, direction: 'desc' });
    }
    for (const filter of filterOptions) {
      for (const having of havingOptions) {
        for (const sort of sortOptions) {
          const nextTable = {
            ...table, columns, sort: [sort],
            ...(filter ? { filter } : { filter: undefined }),
            ...(having ? { having } : { having: undefined }),
          };
          addVariant({ ...input.plan, tables: input.plan.tables.map((candidate) => candidate.id === table.id ? nextTable : candidate) });
          if (variants.length >= 192) return variants;
        }
      }
    }
  }
  return variants;
}
