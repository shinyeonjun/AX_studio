import { readFileSync } from 'node:fs';
import type { InvestigationRunner } from '../../../intelligence/agent/investigation-runner.js';
import type { DecisionEngine } from '../../../contracts/decision.js';
import type { ExecutionLogEntry } from '../../../connectors/types.js';
import type { PdfReportPairAnalysis, PdfReportSpans, PdfReportValueRemoval } from '../../read/types/pdf.js';
import { inferExampleValues } from './example-values.js';
import type { ReportLayoutPlan } from '../layout/schema.js';
import type { ReportSourceSnapshot, ReportPlan } from '../plan/schema.js';
import { executeReportPlan } from '../plan/execute.js';
import { reportExecutionMetadata } from '../period-metadata.js';
import { assertReusableReportPlan } from '../plan/reusability.js';
import type { ReportHttpProbe, ReportHttpProbeCorrection } from '../source/probe.js';
import { refineReportCapturePlan } from './capture-refinement.js';
import {
  ReportLayoutInferenceSchema,
  type ReportSourceNeed,
  type ReportUnavailableSource,
  type ReportBusinessInference,
  type ReportCaptureInference,
} from './schema.js';
import { inferWithEvidence } from './evidence.js';
import {
  boundedJson,
  imagesForPair,
  inferReportFormats,
  promptCalculationPair,
  repairExamplePeriodExpressions,
  repairExamplePresentationBindings,
  repairExampleScalarBindings,
  repairExampleTextBindings,
  repairExampleTextFragments,
  repairReportMetadataTextReferences,
  sourceDateCoverage,
} from './presentation-repair.js';
import { discoverReportSources, type ReportSourceInspection } from './source-discovery.js';
import {
  inspectReportCatalog,
  reportSourceCatalogSummary,
  type ReportFileSummary,
  type ReportHttpConnectionSummary,
} from './catalog.js';
import { reportFileSources } from '../source/schema.js';
import {
  reportSourceCandidateKey,
  selectAndInspectReportSources,
  type ReportSourceCandidateRequest,
  type ReportSourceEvidence,
} from './source-candidates.js';
import {
  promptPair,
  SOURCE_PLANNER_GOAL,
  BUSINESS_PLANNER_GOAL,
  BUSINESS_REVISION_GOAL,
} from './planner-prompts.js';
import { repairReportScalarBindings } from './layout-bindings.js';
import { mergeReportPlan, mergeReportLayoutBindings } from './inference-merge.js';
import {
  validateCapturePlan,
  repairReportPlanStructure,
  validateBusinessPlan,
  assertReportPlanSourcesCaptured,
  assertReportPlanFieldsJoined,
  assertReportPlanTableCoverage,
  validateRefinedCapturePlan,
} from './plan-validation.js';
import {
  type ReportPlanReplayFailure,
  describeReportReplayMismatches,
  repairExampleReplayAndPresentation,
} from './replay-revision.js';
import { inferReportSourceRequirements, type ReportSourceRequirementsInput } from './source-requirements.js';

export {
  repairReportLayoutBindings,
  repairReportTableCapacities,
  repairReportScalarBindings,
} from './layout-bindings.js';
export { mergeReportBusinessInference } from './inference-merge.js';
export {
  validateCapturePlan,
  assertReportPlanTableCoverage,
  validateRefinedCapturePlan,
} from './plan-validation.js';
export { repairExampleReplayInference, describeReportReplayMismatches } from './replay-revision.js';
export type { ReportPlanReplayFailure, ReportReplayMismatchDiagnostic } from './replay-revision.js';

export type { ReportFileSummary, ReportHttpConnectionSummary } from './catalog.js';
export {
  inferReportFormats,
  pruneUnboundReportTexts,
  repairExamplePeriodExpressions,
  repairExamplePresentationBindings,
  repairExampleScalarBindings,
  repairExampleTextBindings,
  repairExampleTextFragments,
  repairReportDatasetReferences,
  repairReportFieldAliases,
  repairReportMetadataReferences,
  repairReportMetadataTextReferences,
  repairReportMissingJoins,
  repairReportSourceAliases,
  repairStaticDerivedTableLabels,
  repairStaticTextBindingConflicts,
} from './presentation-repair.js';
export type { ReplayRepairInput, ReplayRepairResult } from './replay-repair.js';

export interface ReportPlannerOptions {
  readImage?: (path: string) => Uint8Array;
  maxPlanningChars?: number;
  decisionEngine?: DecisionEngine;
}

export class ReportPlanner {
  private readonly readImage: (path: string) => Uint8Array;
  private readonly maxPlanningChars: number;
  private decisionEngine?: DecisionEngine;

  constructor(
    private readonly runner: InvestigationRunner,
    options: ReportPlannerOptions = {},
  ) {
    this.readImage = options.readImage ?? ((path) => readFileSync(path));
    this.maxPlanningChars = options.maxPlanningChars ?? 600_000;
    this.decisionEngine = options.decisionEngine;
  }

  setDecisionEngine(decisionEngine?: DecisionEngine): void {
    this.decisionEngine = decisionEngine;
  }

  forExecution(stage: <T>(name: string, input: unknown, run: () => Promise<T>) => Promise<T>): ReportPlanner {
    const runner = this.runner;
    return new ReportPlanner({
      get providerName() { return runner.providerName; },
      async run<T>(request: import('../../../intelligence/agent/investigation-runner.js').InvestigationRunRequest<T>) {
        if (request.abortSignal?.aborted) throw new Error('agent_aborted');
        const result = await stage(request.logContext ?? 'report-inference',
          { version: 3, context: request.context, user: request.user }, async () => {
            const generated = await runner.run(request);
            if (request.abortSignal?.aborted) throw new Error('agent_aborted');
            return { output: request.outputSchema.parse(generated.output) };
          });
        // Persisted wire data must satisfy today's domain contract on resume.
        if (request.abortSignal?.aborted) throw new Error('agent_aborted');
        return { output: request.outputSchema.parse(result.output) };
      },
    }, { readImage: this.readImage, maxPlanningChars: this.maxPlanningChars,
      decisionEngine: this.decisionEngine });
  }

  async inferExampleValues(input: {
    goal: string;
    spans: PdfReportSpans;
    signal?: AbortSignal;
    log?: (entry: ExecutionLogEntry) => void;
  }): Promise<PdfReportValueRemoval[]> {
    return inferExampleValues(this.runner, { ...input, readImage: this.readImage, maxChars: this.maxPlanningChars });
  }

  async inferSourceRequirements(input: ReportSourceRequirementsInput): Promise<ReportSourceNeed[]> {
    return inferReportSourceRequirements(this.decisionEngine, input);
  }

  async inferCapturePlan(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    /** CSV/xlsx files in connected folders. */
    files?: ReportFileSummary[];
    connectedConnectors: string[];
    requirements?: ReportSourceNeed[];
    unavailableSources?: ReportUnavailableSource[];
    previousCapture?: ReportCaptureInference;
    signal?: AbortSignal;
    log?: (entry: ExecutionLogEntry) => void;
    inspectSource?: (request: ReportSourceInspection, abortSignal?: AbortSignal) => Promise<unknown>;
  }): Promise<ReportCaptureInference> {
    const requirements = input.requirements ?? [];
    const files = input.files ?? [];
    const selectionActive = Boolean(this.decisionEngine && requirements.length);
    const approvedCandidates = new Set<string>();
    const deniedCandidates = new Set<string>();
    const authorizeCandidates = async (requests: readonly ReportSourceCandidateRequest[], signal?: AbortSignal) => {
      const uniqueRequests = [...new Map(requests.map(request => [reportSourceCandidateKey(request), request])).values()];
      if (uniqueRequests.some(request => request.kind === 'rdb_table'
        ? !input.rdbTables.includes(request.table)
        : request.kind === 'file_sheet'
          ? !files.some(file => file.folderId === request.folderId && file.path === request.path)
          : !input.httpConnections.some(connection => connection.id === request.connectionId))) {
        throw Object.assign(new Error('report_source_inspection_denied'), { code: 'report_source_inspection_denied' });
      }
      const pending = uniqueRequests.filter(request => {
        const key = reportSourceCandidateKey(request);
        return !approvedCandidates.has(key) && !deniedCandidates.has(key);
      });
      const selectedEvidence = pending.length && this.decisionEngine && requirements.length
        ? await selectAndInspectReportSources({
          decisionEngine: this.decisionEngine,
          goal: input.goal,
          pair: input.pair,
          requirements,
          httpConnections: input.httpConnections,
          rdbTables: input.rdbTables,
          files,
          candidateRequests: pending,
          inspectSource: input.inspectSource,
          signal,
          log: input.log,
        })
        : [];
      for (const item of selectedEvidence) {
        approvedCandidates.add(reportSourceCandidateKey(item.request as ReportSourceCandidateRequest));
      }
      for (const request of pending) {
        const key = reportSourceCandidateKey(request);
        if (!approvedCandidates.has(key)) deniedCandidates.add(key);
      }
      return {
        selectedEvidence,
        deniedRequests: uniqueRequests.filter(request => deniedCandidates.has(reportSourceCandidateKey(request))),
      };
    };
    const sourceCatalog = reportSourceCatalogSummary(input.httpConnections, input.rdbTables, files);
    const initialCatalog = sourceCatalog.httpConnections + sourceCatalog.httpOperations + sourceCatalog.rdbTables
      + sourceCatalog.files <= 16
      ? inspectReportCatalog(input.httpConnections, input.rdbTables, { kind: 'catalog', limit: 16 }, files)
      : undefined;
    return discoverReportSources({
      runner: this.runner,
      requirements,
      ...(selectionActive && this.decisionEngine ? { prepare: async signal => {
        const selected = await selectAndInspectReportSources({
          decisionEngine: this.decisionEngine!,
          goal: input.goal,
          pair: input.pair,
          requirements,
          httpConnections: input.httpConnections,
          rdbTables: input.rdbTables,
          files,
          inspectSource: input.inspectSource,
          signal,
          log: input.log,
        });
        selected.forEach(item => approvedCandidates.add(
          reportSourceCandidateKey(item.request as ReportSourceCandidateRequest),
        ));
        return selected;
      } } : {}),
      signal: input.signal,
      maxChars: this.maxPlanningChars,
      inspect: async (request, abortSignal) => {
        if (request.kind === 'catalog') {
          return inspectReportCatalog(input.httpConnections, input.rdbTables, request, files);
        }
        let selectedEvidence: ReportSourceEvidence[] = [];
        if (selectionActive) {
          const authorization = await authorizeCandidates([request], abortSignal);
          if (authorization.deniedRequests.length) {
            return { available: false, reason: 'jev_source_candidate_not_selected' };
          }
          selectedEvidence = authorization.selectedEvidence;
          const selected = selectedEvidence.find(item => reportSourceCandidateKey(
            item.request as ReportSourceCandidateRequest,
          ) === reportSourceCandidateKey(request));
          if (selected && request.kind !== 'http_connection') return selected.result;
        }
        if (request.kind === 'http_operation') {
          return inspectReportCatalog(input.httpConnections, input.rdbTables, request);
        }
        if (!input.inspectSource) throw new Error('report_source_discovery_needs_input');
        return input.inspectSource(request, abortSignal);
      },
      validate: async (plan, evidence, abortSignal) => {
        if (input.unavailableSources?.length && plan.capturePlan.rdb.length) throw new Error('report_rdb_schema_failed');
        const validated = validateCapturePlan(plan, input.httpConnections, input.rdbTables, files);
        if (selectionActive) {
          const requests: ReportSourceCandidateRequest[] = [
            ...validated.capturePlan.http.map(source => ({ kind: 'http_operation' as const,
              connectionId: source.connectionId!, path: source.path })),
            ...validated.capturePlan.rdb.map(source => ({ kind: 'rdb_table' as const, table: source.table })),
            ...reportFileSources(validated.capturePlan).map(source => ({ kind: 'file_sheet' as const,
              folderId: source.folderId, path: source.path, ...(source.sheet ? { sheet: source.sheet } : {}) })),
          ];
          const authorization = await authorizeCandidates(requests, abortSignal);
          for (const item of authorization.selectedEvidence) {
            if (JSON.stringify(item.result).length > 24_000) throw new Error('report_source_discovery_evidence_limit');
            evidence.push(item);
          }
          if (authorization.deniedRequests.length) throw new Error('report_source_candidate_not_selected');
          if (authorization.selectedEvidence.length) throw new Error('report_source_candidates_added');
        }
        return validated;
      },
      context: {
        skillGoal: SOURCE_PLANNER_GOAL,
        taskGoal: input.goal,
        evidence: [
          { source: 'blank-template', detail: `${input.pair.pageCount} rendered PDF pages` },
          { source: 'completed-example', detail: `${input.pair.scalarSlots.length} scalar slots and ${input.pair.tableGroups.length} table groups` },
          { source: 'source-catalog', detail: `${input.httpConnections.length} HTTP connections, ${input.rdbTables.length} DB tables and ${files.length} sheet files` },
        ],
        untrustedData: boundedJson({
          reportGeometry: promptPair(input.pair),
          sourceCatalog,
          ...(initialCatalog && !selectionActive ? { initialCatalog } : {}),
          requirements,
          ...(input.unavailableSources?.length ? { unavailableSources: input.unavailableSources } : {}),
          previousCapture: input.previousCapture,
        }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      user: input.goal,
      images: imagesForPair(input.pair, this.readImage),
    });
  }

  async refineCapturePlan(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    provisional: ReportCaptureInference;
    httpProbes: ReportHttpProbe[];
    staticQueryCorrections?: ReportHttpProbeCorrection[];
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    files?: ReportFileSummary[];
    connectedConnectors: string[];
    signal?: AbortSignal;
    log?: (entry: ExecutionLogEntry) => void;
  }): Promise<ReportCaptureInference> {
    const refined = await refineReportCapturePlan({
      decisionEngine: this.decisionEngine,
      goal: input.goal,
      pair: input.pair,
      provisional: input.provisional,
      httpProbes: input.httpProbes,
      staticQueryCorrections: input.staticQueryCorrections,
      httpConnections: input.httpConnections,
      signal: input.signal,
      log: input.log,
    });
    return validateRefinedCapturePlan(
      input.provisional,
      refined,
      input.httpConnections,
      input.rdbTables,
      input.files,
    );
  }

  async inferReportPlan(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    capture: ReportCaptureInference;
    exampleSources: Record<string, ReportSourceSnapshot>;
    connectedConnectors: string[];
  }): Promise<ReportBusinessInference> {
    const inferredReportPlan = await this.inferCalculation(input, {
      context: {
        skillGoal: `${BUSINESS_PLANNER_GOAL}\nThis call produces only reportPlan. Layout and filename bindings are a separate host-validated stage.`,
        taskGoal: input.goal,
        evidence: [
          { source: 'completed-example', detail: 'Every generated value must replay against its discovered dynamic PDF slot.' },
          { source: 'blank-template', detail: 'Only discovered template geometry may be used.' },
          { source: 'captured-example-data', detail: 'Transport completeness and fingerprints do not prove historical or cross-source consistency. Inspect provenance and temporal source fields before inferring period rules.' },
        ],
        untrustedData: boundedJson({
          reportGeometry: promptCalculationPair(input.pair),
          examplePeriod: input.capture.examplePeriod,
          targetPeriod: input.capture.targetPeriod,
          capturePlan: input.capture.capturePlan,
          sourceDateCoverage: sourceDateCoverage(input.exampleSources, input.capture.examplePeriod),
        }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      logContext: 'report-business-plan',
    });
    return this.inferLayout(input, inferredReportPlan, 'report-layout-plan');
  }

  private inferCalculation(input: {
    goal: string; pair: PdfReportPairAnalysis; capture: ReportCaptureInference;
    exampleSources: Record<string, ReportSourceSnapshot>;
  }, request: {
    context: import('../../../intelligence/agent/types.js').InvestigateAgentContext;
    logContext: string;
  }) {
    const exampleMetadata = reportExecutionMetadata(input.capture.examplePeriod, input.capture.capturePlan, 'example');
    return inferWithEvidence({ runner: this.runner, context: request.context,
      user: input.goal, phase: request.logContext, sources: input.exampleSources,
      pageCount: input.pair.pageCount, maxChars: this.maxPlanningChars,
      validatePlan: plan => {
        const normalized = repairReportMetadataTextReferences(
          repairReportPlanStructure(plan, input.capture, input.exampleSources), exampleMetadata,
        );
        Object.assign(plan, normalized);
        assertReportPlanSourcesCaptured(plan, input.capture);
        assertReportPlanFieldsJoined(plan, input.capture);
        if (!request.logContext.endsWith('-revision')) {
          assertReportPlanTableCoverage(plan, input.pair);
        }
        assertReusableReportPlan(plan, input.capture);
        try {
          // Validate executable types and dataset references while the example
          // snapshot is available. This turns model plans such as date-minus-
          // one or an unknown dataset into a bounded correction instead of
          // discovering the error only after the revision loop.
          executeReportPlan(plan, input.exampleSources, exampleMetadata);
        } catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith('report_')) throw error;
          const code = error.message.split(':', 1)[0]!.slice(0, 120);
          throw new Error(`report_plan_execution_invalid:${code}`);
        }
      },
      readPage: (document, pageIndex) => {
        const paths = document === 'template' ? input.pair.templateImages : input.pair.exampleImages;
        const path = paths[pageIndex];
        if (!path) throw new Error('report_evidence_page_invalid');
        return { data: this.readImage(path), mimeType: 'image/png', pageIndex,
          filename: `${document}-page-${pageIndex + 1}.png` };
      },
    });
  }

  private async inferLayout(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    capture: ReportCaptureInference;
    exampleSources: Record<string, ReportSourceSnapshot>;
    connectedConnectors: string[];
  }, reportPlan: ReportPlan, logContext: string, previousLayout?: ReportLayoutPlan): Promise<ReportBusinessInference> {
    reportPlan = repairReportPlanStructure(reportPlan, input.capture, input.exampleSources);
    assertReportPlanSourcesCaptured(reportPlan, input.capture);
    assertReportPlanFieldsJoined(reportPlan, input.capture);
    assertReportPlanTableCoverage(reportPlan, input.pair);
    assertReusableReportPlan(reportPlan, input.capture);
    const metadata = reportExecutionMetadata(input.capture.examplePeriod, input.capture.capturePlan, 'example');
    let calculated: ReturnType<typeof executeReportPlan> | undefined;
    let calculationError: string | undefined;
    try {
      calculated = executeReportPlan(reportPlan, input.exampleSources, metadata);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('report_')) throw error;
      // The service owns bounded replay/revision. Preserve its ability to repair
      // calculation errors instead of failing before that loop can run.
      calculationError = error.message.slice(0, 300);
    }
    const result = await this.runner.run({
      outputSchema: ReportLayoutInferenceSchema,
      context: {
        skillGoal: `Bind every discovered scalar slot and table group to the supplied calculated outputs or metadata. Return only the layout schema. Calculation is immutable. Use metadata tokens for period-dependent filenames. Preserve the PDF template; never invent coordinates, literal values, sources or calculations. Exactly one tableBinding is required for each detected group (${input.pair.tableGroups.map((group) => `${group.id}=${group.columnCount} columns`).join(', ') || 'none'}). Use a distinct calculated table for each group; its columnId values must come from that table and its column count must match the group. Never reuse one table to fill multiple groups or omit a group.`,
        taskGoal: input.goal,
        evidence: [{ source: 'host-calculated-example', detail: 'Only calculated outputs and metadata are supplied; raw source rows are not needed for layout binding.' }],
        untrustedData: boundedJson({ reportGeometry: promptPair(input.pair), calculated, metadata,
          ...(previousLayout ? { previousLayout } : {}),
          ...(calculationError ? { calculationError, reportPlan } : {}) }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      user: input.goal,
      // A revision carries forward its image-grounded layout, so the same PDF pages add no new evidence.
      ...(previousLayout ? {} : { images: imagesForPair(input.pair, this.readImage) }),
      logContext,
    });
    let finalReportPlan = reportPlan;
    if (calculated) {
      finalReportPlan = repairExamplePeriodExpressions(reportPlan, result.output.layout, input.pair, metadata);
      finalReportPlan = inferReportFormats(finalReportPlan, result.output.layout, input.pair);
      try {
        calculated = executeReportPlan(finalReportPlan, input.exampleSources, metadata);
      } catch {
        // Format inference must never hide a calculation failure. The original
        // plan and replay diagnostics remain available for the next revision.
        finalReportPlan = reportPlan;
      }
    }
    let layout = previousLayout
      ? mergeReportLayoutBindings(previousLayout, result.output.layout)
      : result.output.layout;
    layout = repairReportScalarBindings(layout, input.pair);
    if (calculated) {
      const repairedFragments = repairExampleTextFragments(finalReportPlan, layout, input.pair, calculated, metadata);
      finalReportPlan = repairedFragments.plan;
      layout = repairedFragments.layout;
      const repairedTextBindings = repairExampleTextBindings(finalReportPlan, layout, input.pair, calculated, metadata);
      finalReportPlan = repairedTextBindings.plan;
      layout = repairedTextBindings.layout;
      layout = repairExampleScalarBindings(layout, input.pair, calculated, metadata);
      const repairedPresentation = repairExamplePresentationBindings(finalReportPlan, layout, input.pair, metadata);
      finalReportPlan = repairedPresentation.plan;
      layout = repairedPresentation.layout;
    }
    return validateBusinessPlan({ schemaVersion: 1, reportPlan: finalReportPlan, layout }, input.capture, input.pair, input.exampleSources);
  }

  async reviseReportPlan(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    capture: ReportCaptureInference;
    exampleSources: Record<string, ReportSourceSnapshot>;
    previous: ReportBusinessInference;
    replayFailure: ReportPlanReplayFailure;
    connectedConnectors: string[];
  }): Promise<ReportBusinessInference> {
    const exampleMetadata = reportExecutionMetadata(
      input.capture.examplePeriod,
      input.capture.capturePlan,
      'example',
    );
    // Replay failures are often caused by a small, generic shape mistake in a
    // model response. Try bounded host repairs first; this avoids spending the
    // entire evidence budget asking a model to rediscover captured arithmetic.
    const deterministic = repairExampleReplayAndPresentation({
      plan: input.previous.reportPlan,
      layout: input.previous.layout,
      pair: input.pair,
      sources: input.exampleSources,
      metadata: exampleMetadata,
    });
    if (!deterministic.executionError && deterministic.mismatches.length === 0) {
      return validateBusinessPlan({
        schemaVersion: 1,
        reportPlan: deterministic.plan,
        layout: deterministic.layout,
      }, input.capture, input.pair, input.exampleSources);
    }

    const boundedMismatches = input.replayFailure.mismatches?.slice(0, 40).map((mismatch) => ({
      slotId: mismatch.slotId.slice(0, 200),
      expected: mismatch.expected.slice(0, 500),
      actual: mismatch.actual.slice(0, 500),
    }));
    const replayFailure = {
      ...(input.replayFailure.executionError
        ? { executionError: input.replayFailure.executionError.slice(0, 300) }
        : {}),
      ...(boundedMismatches ? { mismatches: boundedMismatches,
        diagnostics: describeReportReplayMismatches(input.pair, boundedMismatches) } : {}),
    };
    const inferredReportPlan = await this.inferCalculation(input, {
      context: {
        skillGoal: `${BUSINESS_PLANNER_GOAL}\n${BUSINESS_REVISION_GOAL}\nReturn only the calculation plan. Layout is handled separately.`,
        taskGoal: input.goal,
        evidence: [
          { source: 'completed-example-replay', detail: 'Only example-period expected/actual slot evidence is supplied.' },
          { source: 'target-isolation', detail: 'No target-period source snapshot is available during revision.' },
        ],
        untrustedData: boundedJson({
          reportGeometry: promptCalculationPair(input.pair),
          examplePeriod: input.capture.examplePeriod,
          targetPeriod: input.capture.targetPeriod,
          capturePlan: input.capture.capturePlan,
          sourceDateCoverage: sourceDateCoverage(input.exampleSources, input.capture.examplePeriod),
          previous: input.previous,
          replayFailure,
        }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      logContext: 'report-business-plan-revision',
    });
    const reportPlan = repairReportPlanStructure(
      mergeReportPlan(input.previous.reportPlan, inferredReportPlan), input.capture,
    );
    const retainedLayout = repairExampleReplayAndPresentation({
      plan: reportPlan,
      layout: input.previous.layout,
      pair: input.pair,
      sources: input.exampleSources,
      metadata: exampleMetadata,
    });
    if (!retainedLayout.executionError && retainedLayout.mismatches.length === 0) {
      return validateBusinessPlan({
        schemaVersion: 1,
        reportPlan: retainedLayout.plan,
        layout: retainedLayout.layout,
      }, input.capture, input.pair, input.exampleSources);
    }

    const revised = await this.inferLayout(input, reportPlan, 'report-layout-plan-revision', input.previous.layout);
    const repaired = repairExampleReplayAndPresentation({
      plan: revised.reportPlan,
      layout: revised.layout,
      pair: input.pair,
      sources: input.exampleSources,
      metadata: exampleMetadata,
    });
    return { ...revised, reportPlan: repaired.plan, layout: repaired.layout };
  }
}
