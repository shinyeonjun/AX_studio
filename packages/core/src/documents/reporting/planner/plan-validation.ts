import type { PdfReportPairAnalysis } from '../../read/types/pdf.js';
import type { ReportSourceSnapshot } from '../plan/schema.js';
import { ReportPlanSchema, type ReportPlan } from '../plan/schema.js';
import { assertReportPlanFieldSourcesJoined } from '../plan/execute.js';
import { reportExecutionMetadata } from '../period-metadata.js';
import { assertReusableReportPlan, assertReusableReportPresentation } from '../plan/reusability.js';
import { ReportSourceCapturePlanSchema } from '../source/schema.js';
import {
  ReportCaptureInferenceSchema,
  type ReportBusinessInference,
  type ReportCaptureInference,
} from './schema.js';
import {
  pruneUnboundReportTexts,
  repairReportDatasetReferences,
  repairReportFieldAliases,
  repairReportMetadataReferences,
  repairReportMetadataTextReferences,
  repairReportMissingJoins,
  repairReportSourceAliases,
  repairStaticTextBindings,
  repairStaticTextValues,
  repairStaticDerivedTableLabels,
  repairStaticTextBindingConflicts,
} from './presentation-repair.js';
import type { ReportHttpConnectionSummary } from './catalog.js';
import {
  repairReportLayoutBindings,
  repairReportTableCapacities,
  repairReportScalarBindings,
} from './layout-bindings.js';

export function validateCapturePlan(
  inference: ReportCaptureInference,
  httpConnections: ReportHttpConnectionSummary[],
  rdbTables: string[],
): ReportCaptureInference {
  inference = ReportCaptureInferenceSchema.parse(inference);
  const capturePlan = ReportSourceCapturePlanSchema.parse(inference.capturePlan);
  const knownConnections = new Set(httpConnections.map((connection) => connection.id));
  const knownTables = new Set(rdbTables);
  const normalized = capturePlan.http.map((source) => {
    const connectionId = source.connectionId ?? (httpConnections.length === 1 ? httpConnections[0]!.id : undefined);
    if (!connectionId) throw new Error(`report_http_connection_required:${source.alias}`);
    if (!knownConnections.has(connectionId)) throw new Error(`report_http_connection_unknown:${source.alias}`);
    return { ...source, connectionId };
  });
  for (const source of capturePlan.rdb) {
    if (!knownTables.has(source.table)) throw new Error(`report_rdb_table_unknown:${source.alias}`);
  }
  const aliases = [...normalized.map((source) => source.alias), ...capturePlan.rdb.map((source) => source.alias)];
  if (aliases.includes('meta')) throw new Error('report_source_alias_reserved:meta');
  if (new Set(aliases).size !== aliases.length) throw new Error('report_source_alias_duplicate');
  return { ...inference, capturePlan: { ...capturePlan, http: normalized } };
}

/**
 * Apply the host-owned structural repairs in one order. These repairs are
 * intentionally kept behind the planner seam: source aliases and metadata
 * must be normalized before captured fields and inferred joins are checked.
 * Keeping the order here prevents the planning, layout, and revision paths
 * from drifting apart while leaving the individual repair functions directly
 * testable.
 */
export function repairReportPlanStructure(
  plan: ReportPlan,
  capture: Pick<ReportCaptureInference, 'capturePlan'>,
  sources?: Record<string, ReportSourceSnapshot>,
): ReportPlan {
  let repaired = repairReportDatasetReferences(repairReportSourceAliases(
    repairReportMetadataReferences(plan, capture), capture,
  ));
  if (!sources) return repaired;
  repaired = repairReportFieldAliases(repaired, sources);
  repaired = repairReportMissingJoins(repaired, sources);
  return repairStaticDerivedTableLabels(repaired);
}

export function validateBusinessPlan(
  inference: ReportBusinessInference,
  capture: ReportCaptureInference,
  pair: PdfReportPairAnalysis,
  exampleSources: Record<string, ReportSourceSnapshot>,
): ReportBusinessInference {
  inference = { ...inference, reportPlan: repairReportPlanStructure(
    inference.reportPlan, capture, exampleSources,
  ) };
  assertReportPlanSourcesCaptured(inference.reportPlan, capture);
  assertReportPlanFieldsJoined(inference.reportPlan, capture);
  assertReportPlanTableCoverage(inference.reportPlan, pair);
  const exampleMetadata = reportExecutionMetadata(capture.examplePeriod, capture.capturePlan, 'example');
  const candidatePlan = repairStaticTextValues(
    repairReportMetadataTextReferences(inference.reportPlan, exampleMetadata), inference.layout, pair,
  );
  const staticConflicts = repairStaticTextBindingConflicts(candidatePlan, inference.layout, pair);
  const candidateLayout = repairReportScalarBindings(
    repairStaticTextBindings(staticConflicts.plan, staticConflicts.layout, pair), pair,
  );
  const reportPlan = repairReportTableCapacities(
    pruneUnboundReportTexts(staticConflicts.plan, candidateLayout), candidateLayout, pair,
  );
  assertReusableReportPlan(reportPlan, capture);
  const layout = repairReportLayoutBindings(reportPlan, candidateLayout, pair);
  assertReusableReportPresentation(reportPlan, layout, pair, capture);
  return { ...inference, reportPlan, layout };
}

export function assertReportPlanSourcesCaptured(plan: ReportPlan, capture: ReportCaptureInference): void {
  const aliases = new Set([
    ...capture.capturePlan.http.map((source) => source.alias),
    ...capture.capturePlan.rdb.map((source) => source.alias),
  ]);
  for (const source of [plan, ...(plan.datasets ?? [])]
    .flatMap(dataset => [dataset.baseSource, ...dataset.joins.map(join => join.source)])) {
    if (!aliases.has(source)) throw new Error(`report_plan_source_not_captured:${source}`);
  }
}

export function assertReportPlanFieldsJoined(plan: ReportPlan, capture: ReportCaptureInference): void {
  assertReportPlanFieldSourcesJoined(plan, [
    ...capture.capturePlan.http.map((source) => source.alias),
    ...capture.capturePlan.rdb.map((source) => source.alias),
  ]);
}

/**
 * Every physical table in the completed example needs a distinct result table
 * before layout inference starts. A table may expose more columns than the
 * template group uses, so capacity is a lower bound rather than an exact
 * shape. Matching the largest groups first avoids a false rejection when the
 * model returns tables in a different order.
 */
export function assertReportPlanTableCoverage(
  input: ReportPlan,
  pair: PdfReportPairAnalysis,
): void {
  if (pair.tableGroups.length === 0) return;
  const plan = ReportPlanSchema.parse(input);
  const tableById = new Map(plan.tables.map((table) => [table.id, table]));
  const widthFor = (tableId: string, visiting = new Set<string>()): number => {
    if (visiting.has(tableId)) return 0;
    const table = tableById.get(tableId);
    if (!table) return 0;
    if (table.kind === 'aggregate') return table.columns.length;
    if (table.columns) return table.columns.length;
    return widthFor(table.sourceTable, new Set(visiting).add(tableId));
  };
  const capacities = plan.tables
    .map((table) => widthFor(table.id))
    .sort((left, right) => right - left);
  const groups = pair.tableGroups
    .map((group, index) => ({ group, index }))
    .sort((left, right) => right.group.columnCount - left.group.columnCount || left.index - right.index);
  for (const [index, entry] of groups.entries()) {
    if ((capacities[index] ?? 0) < entry.group.columnCount) {
      throw new Error(`report_plan_table_coverage_incomplete:${entry.group.id}`);
    }
  }
}

function captureSelectionKey(capture: ReportCaptureInference): string {
  return JSON.stringify({
    http: capture.capturePlan.http.map((source) => ({
      alias: source.alias,
      connectionId: source.connectionId,
      path: source.path,
      staticQuery: source.staticQuery,
    })),
    rdb: capture.capturePlan.rdb.map((source) => ({ alias: source.alias, table: source.table })),
  });
}

export function validateRefinedCapturePlan(
  provisional: ReportCaptureInference,
  candidate: ReportCaptureInference,
  httpConnections: ReportHttpConnectionSummary[],
  rdbTables: string[],
): ReportCaptureInference {
  const refined = validateCapturePlan(candidate, httpConnections, rdbTables);
  if (
    JSON.stringify(refined.examplePeriod) !== JSON.stringify(provisional.examplePeriod)
    || JSON.stringify(refined.targetPeriod) !== JSON.stringify(provisional.targetPeriod)
  ) {
    throw new Error('report_capture_refinement_period_changed');
  }
  if (captureSelectionKey(refined) !== captureSelectionKey(provisional)) {
    throw new Error('report_capture_refinement_selection_changed');
  }
  return refined;
}
