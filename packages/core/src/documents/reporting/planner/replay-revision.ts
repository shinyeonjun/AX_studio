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
