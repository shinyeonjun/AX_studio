import type { ReportSourceSnapshot } from '../plan/schema.js';
import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import { executeReportPlan, type ReportPlanResult } from '../plan/execute.js';
import {
  inferReportFormats,
  repairExamplePeriodExpressions,
  repairExamplePresentationBindings,
  repairExampleScalarBindings,
  repairExampleTextBindings,
  repairExampleTextFragments,
  repairReportFieldAliases,
  repairReportMetadataTextReferences,
  repairReportMissingJoins,
  repairStaticDerivedTableLabels,
  repairStaticTextBindingConflicts,
} from './presentation-repair.js';
import {
  repairExampleReplayInference as repairExampleReplayInferenceImpl,
  type ReplayRepairInput,
  type ReplayRepairResult,
} from './replay-repair.js';

/** Preserve the established planner import path while replay logic lives in its cohesive module. */
export function repairExampleReplayInference(input: ReplayRepairInput): ReplayRepairResult {
  return repairExampleReplayInferenceImpl(input);
}

export interface ReportPlanReplayFailure {
  mismatches?: Array<{ slotId: string; expected: string; actual: string }>;
  diagnostics?: ReportReplayMismatchDiagnostic[];
  executionError?: string;
}

export type ReportReplayMismatchDiagnostic = {
  slotId: string;
  expected: string;
  actual: string;
  kind: 'scalar' | 'table' | 'unknown';
  pageIndex?: number;
  groupId?: string;
  rowIndex?: number;
  columnIndex?: number;
};

/**
 * Replay failures use PDF slot ids because that is the stable comparison
 * boundary. Add the owning table/row/column without exposing source rows so a
 * revision model can repair a table's filter or ordering instead of treating
 * every mismatch as an unrelated scalar.
 */
export function describeReportReplayMismatches(
  pair: PdfReportPairAnalysis,
  mismatches: Array<{ slotId: string; expected: string; actual: string }>,
): ReportReplayMismatchDiagnostic[] {
  const locations = new Map<string, Omit<ReportReplayMismatchDiagnostic, 'slotId' | 'expected' | 'actual'>>();
  for (const slot of pair.scalarSlots) {
    locations.set(slot.id, { kind: 'scalar', pageIndex: slot.pageIndex });
  }
  for (const group of pair.tableGroups) {
    for (const row of group.rows) {
      for (const [columnIndex, slot] of row.cells.entries()) {
        // Scalar slots take precedence if malformed input repeats an id; the
        // host's existing layout validation will reject ambiguous bindings.
        if (locations.has(slot.id)) continue;
        locations.set(slot.id, {
          kind: 'table', groupId: group.id, rowIndex: row.index,
          columnIndex, pageIndex: slot.pageIndex,
        });
      }
    }
  }
  return mismatches.map((mismatch) => ({
    ...mismatch,
    ...(locations.get(mismatch.slotId) ?? { kind: 'unknown' as const }),
  }));
}

/**
 * Finish an example replay using host-owned deterministic repairs before a
 * model revision is attempted. This keeps presentation fixes (split text,
 * metadata shape and phase labels) beside the calculation replay repairs so a
 * successful result is validated through one path.
 */
export function repairExampleReplayAndPresentation(input: ReplayRepairInput): ReplayRepairResult {
  let plan = repairExamplePeriodExpressions(input.plan, input.layout, input.pair, input.metadata);
  plan = repairStaticDerivedTableLabels(repairReportMissingJoins(
    repairReportFieldAliases(plan, input.sources), input.sources,
  ));
  plan = repairReportMetadataTextReferences(plan, input.metadata);
  let layout = input.layout;
  plan = inferReportFormats(plan, layout, input.pair);
  const staticBindings = repairStaticTextBindingConflicts(plan, layout, input.pair);
  plan = staticBindings.plan;
  layout = staticBindings.layout;
  let replay = repairExampleReplayInference({ ...input, plan, layout });
  if (replay.executionError) return replay;

  layout = replay.layout;
  const periodPlan = repairExamplePeriodExpressions(replay.plan, layout, input.pair, input.metadata);
  const formattedPlan = inferReportFormats(periodPlan, layout, input.pair);
  let calculated: ReportPlanResult;
  try {
    calculated = executeReportPlan(formattedPlan, input.sources, input.metadata);
    plan = formattedPlan;
  } catch {
    // The replay repair itself was executable. If a presentation-only period
    // or format inference is incompatible, retain that known-good plan and
    // let the normal model revision path diagnose the remaining mismatch.
    plan = replay.plan;
    try {
      calculated = executeReportPlan(plan, input.sources, input.metadata);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'report_replay_unavailable';
      return { ...replay, plan, layout, executionError: message.startsWith('report_') ? message.slice(0, 300) : 'report_replay_unavailable' };
    }
  }

  const repairedFragments = repairExampleTextFragments(plan, layout, input.pair, calculated, input.metadata);
  plan = repairedFragments.plan;
  layout = repairedFragments.layout;
  const repairedTextBindings = repairExampleTextBindings(plan, layout, input.pair, calculated, input.metadata);
  plan = repairedTextBindings.plan;
  layout = repairedTextBindings.layout;
  layout = repairExampleScalarBindings(layout, input.pair, calculated, input.metadata);
  const repairedPresentation = repairExamplePresentationBindings(plan, layout, input.pair, input.metadata);
  plan = repairedPresentation.plan;
  layout = repairedPresentation.layout;

  replay = repairExampleReplayInference({ ...input, plan, layout });
  return replay;
}

function displayedNumber(text: string): number | undefined {
  const digits = text.replace(/[^\d.-]/gu, '');
  if (!/\d/u.test(digits)) return undefined;
  const value = Number(digits);
  return Number.isFinite(value) && value !== 0 ? value : undefined;
}

/**
 * When a replayed number is a whole multiple of the example's (or a whole fraction of it), the
 * factor is evidence: an average that needs a per-day or per-item division, or a total counted
 * twice. Name the factor and the captured columns with that many distinct values, so a revision
 * can test that rule instead of guessing.
 */
export function describeReplayScale(
  mismatches: Array<{ slotId: string; expected: string; actual: string }>,
  sources: Record<string, ReportSourceSnapshot>,
): Array<{ slotId: string; actualOverExpected: string; columnsWithThatManyDistinctValues: string[] }> {
  const distinct = new Map<string, number>();
  for (const [alias, source] of Object.entries(sources)) {
    const columns = new Set(source.rows.flatMap((row) => Object.keys(row)));
    for (const column of columns) {
      distinct.set(`${alias}.${column}`, new Set(source.rows.map((row) => JSON.stringify(row[column] ?? null))).size);
    }
  }
  return mismatches.flatMap((mismatch) => {
    const expected = displayedNumber(mismatch.expected);
    const actual = displayedNumber(mismatch.actual);
    if (expected === undefined || actual === undefined) return [];
    const ratio = actual / expected;
    const factor = Math.round(ratio >= 1 ? ratio : 1 / ratio);
    if (factor < 2 || Math.abs((ratio >= 1 ? ratio : 1 / ratio) - factor) > factor * 0.002) return [];
    return [{
      slotId: mismatch.slotId,
      actualOverExpected: ratio.toFixed(3),
      columnsWithThatManyDistinctValues: [...distinct].filter(([, count]) => count === factor).map(([column]) => column).slice(0, 12),
    }];
  });
}
