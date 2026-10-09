import type { ReportLayoutPlan } from '../layout/schema.js';
import type { ReportPlan } from '../plan/schema.js';
import { executeReportPlan } from '../plan/execute.js';
import { materializeReportLayout, verifyReportExampleReplay } from '../layout/materialize.js';
import {
  type ReplayRepairInput,
  type ReplayRepairResult,
  aggregateColumnReferences,
} from './replay-repair/shared.js';
import { applyDerivedCasePredicateVariants } from './replay-repair/predicates.js';
import {
  applyRatioRepairVariants,
  applyMissingScalarMetricVariants,
  applyDerivedTableRatioVariants,
} from './replay-repair/ratio.js';
import {
  applyMissingConcatFieldVariants,
  applyConcatRepairVariants,
} from './replay-repair/concat.js';
import { applyTableRepairVariants } from './replay-repair/table.js';
import { applyDateNotationVariants } from './replay-repair/date-notation.js';
import { applyColumnOrderVariants } from './replay-repair/column-order.js';
import { applyTextNumberFormatVariants } from './replay-repair/text-numbers.js';
import {
  applyAggregateFilterVariants,
  applyAggregateRepairVariants,
} from './replay-repair/aggregate.js';

export { formatFromExampleText } from './replay-repair/shared.js';
export type { ReplayRepairInput, ReplayRepairResult } from './replay-repair/shared.js';

function replayRepairResult(input: ReplayRepairInput, preserveExecutionError = false): ReplayRepairResult | undefined {
  try {
    const result = executeReportPlan(input.plan, input.sources, input.metadata);
    const materialized = materializeReportLayout(input.pair, input.layout, result, input.metadata);
    return { ...input, mismatches: verifyReportExampleReplay(input.pair, materialized.values).mismatches };
  } catch (error) {
    if (preserveExecutionError) {
      const message = error instanceof Error ? error.message : 'report_replay_unavailable';
      return { ...input, mismatches: [], executionError: message.startsWith('report_') ? message.slice(0, 300) : 'report_replay_unavailable' };
    }
    return undefined;
  }
}

/**
 * Models may emit a derived table column before the aggregate columns it
 * references. The plan is still declarative and unambiguous, so normalize the
 * declaration order once. Layout column indices refer to template positions,
 * while column ids select result values, so they remain unchanged.
 * Unknown references and cycles are left for the executor to reject.
 */
function repairDerivedColumnOrder(
  plan: ReportPlan,
  layout: ReportLayoutPlan,
): { plan: ReportPlan; layout: ReportLayoutPlan } {
  let planChanged = false;
  const nextTables = plan.tables.map((table) => {
    if (table.kind !== 'aggregate' || table.columns.length < 2) return table;
    const originalIndex = new Map(table.columns.map((column, index) => [column.id, index]));
    const columnIds = new Set(table.columns.map((column) => column.id));
    const dependencies = new Map(table.columns.map((column) => [
      column.id,
      column.value.kind === 'derived'
        ? new Set([...aggregateColumnReferences(column.value.expression)].filter((id) => columnIds.has(id)))
        : new Set<string>(),
    ]));
    const remaining = new Set(table.columns.map((column) => column.id));
    const orderedIds: string[] = [];
    while (remaining.size > 0) {
      const ready = [...remaining]
        .filter((id) => [...(dependencies.get(id) ?? [])].every((dependency) => !remaining.has(dependency)))
        .sort((left, right) => (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0));
      if (ready.length === 0) return table;
      const next = ready[0]!;
      orderedIds.push(next);
      remaining.delete(next);
    }
    if (orderedIds.every((id, index) => id === table.columns[index]?.id)) return table;
    planChanged = true;
    const columns = orderedIds.map((id) => table.columns[originalIndex.get(id)!]!);
    return { ...table, columns };
  });
  if (!planChanged) return { plan, layout };
  return { plan: { ...plan, tables: nextTables }, layout };
}

/**
 * Use the completed PDF as a bounded oracle for generic, declarative repairs
 * after model revisions. Candidates are built from captured numeric fields,
 * sibling table columns and existing predicates; no example value, id or row
 * is inserted into the reusable plan. A candidate is kept only when it
 * strictly reduces the actual replay mismatch count.
 */
export function repairExampleReplayInference(input: ReplayRepairInput): ReplayRepairResult {
  const ordered = repairDerivedColumnOrder(input.plan, input.layout);
  let currentInput = { ...input, plan: ordered.plan, layout: ordered.layout };
  const initial = replayRepairResult(currentInput, true);
  let current = initial ?? { ...currentInput, mismatches: [], executionError: 'report_replay_unavailable' };
  let currentScore = initial ? initial.mismatches.length : Number.POSITIVE_INFINITY;
  // Keep the search bounded and greedy. Evaluating every cross-product of
  // filters, formulas and sort keys is quadratic in the number of captured
  // fields and made a large report spend its entire deadline in replay. Each
  // generator is ordered from strongest evidence to fallback guesses; accept
  // the first strict improvement, then restart with the new diagnostics so a
  // later repair sees the corrected table shape.
  const generators = [
    // Columns bound the wrong way round are the smallest fix: only bindings move.
    applyColumnOrderVariants,
    applyDerivedCasePredicateVariants,
    applyAggregateFilterVariants,
    applyDerivedTableRatioVariants,
    applyTableRepairVariants,
    applyAggregateRepairVariants,
    applyRatioRepairVariants,
    applyMissingConcatFieldVariants,
    applyConcatRepairVariants,
    applyMissingScalarMetricVariants,
    applyDateNotationVariants,
    applyTextNumberFormatVariants,
  ];
  for (let pass = 0; pass < 8 && currentScore > 0; pass += 1) {
    let improved = false;
    for (const generate of generators) {
      const variants = generate(currentInput, current);
      let accepted: { input: ReplayRepairInput; result: ReplayRepairResult } | undefined;
      for (const variant of variants) {
        const evaluated = replayRepairResult(variant);
        if (!evaluated || evaluated.mismatches.length >= currentScore) continue;
        accepted = { input: variant, result: evaluated };
        break;
      }
      if (!accepted) continue;
      currentInput = accepted.input;
      current = accepted.result;
      currentScore = current.mismatches.length;
      improved = true;
      break;
    }
    if (!improved) break;
  }
  return current;
}
