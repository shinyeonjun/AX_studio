import { readFileSync } from 'node:fs';
import type { InvestigationRunner } from '../../agent/investigation-runner.js';
import type { ModelImageInput } from '../../agent/model/provider.js';
import type { PdfReportPairAnalysis } from '../../document-engine/types/pdf.js';
import type { ReportSourceSnapshot } from '../plan/schema.js';
import type { ReportPlan } from '../plan/schema.js';
import { executeReportPlan } from '../plan/execute.js';
import { reportExecutionMetadata } from '../period-metadata.js';
import { assertReusableReportPlan, assertReusableReportPresentation } from '../plan/reusability.js';
import type { ReportHttpProbe } from '../source/probe.js';
import { ReportSourceCapturePlanSchema } from '../source/schema.js';
import {
  ReportCalculationInferenceSchema,
  ReportLayoutInferenceSchema,
  ReportCaptureInferenceSchema,
  type ReportBusinessInference,
  type ReportCaptureInference,
} from './schema.js';

export interface ReportHttpConnectionSummary {
  id: string;
  label: string;
  /** URL pathname only. Origins and credentials are host-owned and unnecessary for planning. */
  basePath: string;
}

export interface ReportPlannerOptions {
  readImage?: (path: string) => Uint8Array;
  maxPlanningChars?: number;
}

export interface ReportPlanReplayFailure {
  mismatches?: Array<{ slotId: string; expected: string; actual: string }>;
  executionError?: string;
}

interface PairPromptShape {
  pageCount: number;
  pages: PdfReportPairAnalysis['pages'];
  scalarSlots: PdfReportPairAnalysis['scalarSlots'];
  tableGroups: PdfReportPairAnalysis['tableGroups'];
}

function promptPair(pair: PdfReportPairAnalysis): PairPromptShape {
  return {
    pageCount: pair.pageCount,
    pages: pair.pages,
    scalarSlots: pair.scalarSlots,
    tableGroups: pair.tableGroups,
  };
}

function imagesForPair(pair: PdfReportPairAnalysis, readImage: (path: string) => Uint8Array): ModelImageInput[] {
  return [
    ...pair.templateImages.map((path, index) => ({
      data: readImage(path), mimeType: 'image/png', pageIndex: index, filename: `template-page-${index + 1}.png`,
    })),
    ...pair.exampleImages.map((path, index) => ({
      data: readImage(path), mimeType: 'image/png', pageIndex: index, filename: `example-page-${index + 1}.png`,
    })),
  ];
}

function boundedJson(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value);
  if (serialized.length > maxChars) throw new Error('report_planning_context_too_large');
  return serialized;
}

function validateCapturePlan(
  inference: ReportCaptureInference,
  httpConnections: ReportHttpConnectionSummary[],
  rdbTables: string[],
): ReportCaptureInference {
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

function validateBusinessPlan(
  inference: ReportBusinessInference,
  capture: ReportCaptureInference,
  pair: PdfReportPairAnalysis,
): ReportBusinessInference {
  const aliases = new Set([
    ...capture.capturePlan.http.map((source) => source.alias),
    ...capture.capturePlan.rdb.map((source) => source.alias),
  ]);
  for (const source of [inference.reportPlan.baseSource, ...inference.reportPlan.joins.map((join) => join.source)]) {
    if (!aliases.has(source)) throw new Error(`report_plan_source_not_captured:${source}`);
  }
  assertReusableReportPlan(inference.reportPlan, capture);
  assertReusableReportPresentation(inference.reportPlan, inference.layout, pair, capture);
  return inference;
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

function validateRefinedCapturePlan(
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

const SOURCE_PLANNER_GOAL = `
Infer a reusable, read-only source capture contract for a report taught by a completed PDF example.
Return only the supplied structured schema. Identify the example period and requested target period.
HTTP sources may use only relative GET paths, explicit JSON rowsPath (use $ for a root array), bounded pagination, and declared date query parameters.
Select only listed HTTP connections and DB tables. Never invent credentials, physical paths, SQL, writes, POST requests, or external delivery.
Use the visual report and dynamic example values as evidence. If the request and evidence cannot identify a safe source contract, fail instead of guessing.
`;

const SOURCE_REFINER_GOAL = `
Refine a provisional read-only report source contract using a host-captured, value-free JSON shape probe.
Return only the supplied structured schema. Preserve both periods and every selected source alias, connection, path, static query, and DB table exactly.
For each HTTP response, declare the exact rowsPath. When the shape exposes pagination, declare page/size query parameters and the total-pages response path so every page is captured. When the shape exposes period query fields, declare the from/to query parameters.
Never add sources, values, credentials, origins, SQL, writes, POST requests, external delivery, or assumptions not supported by the probe shape and report evidence.
`;

const BUSINESS_PLANNER_GOAL = `
  Infer a reusable declarative report calculation and layout plan from one completed example, its blank template, and captured example-period data.
Return only the supplied structured schema. The report plan must compute every dynamic value from source fields, row counts, joins, predicates, aggregations, derived tables, text templates, or period metadata.
  Do not copy example numbers into literals or encode target values. Do not use hidden future data. Join cardinality must be explicit and conservative; use a join-level where predicate when a dimension contains historical/inactive rows that must be filtered before cardinality validation.
  A join left path is evaluated against the joined row and normally begins with a source alias. A join right path is evaluated against the candidate source row and may be either a bare field path or prefixed by that join's source alias. Join predicates use alias-qualified field paths.
  Period filters must reference host metadata fields such as meta.periodStart and meta.periodEndExclusive; never copy example or target dates into literals. Host metadata also provides reportDate/reportDateKorean/reportDateDot, reportStatus, source.<alias>.path, source.<alias>.table, and source.<alias>.tableName.
  Mark text as computed when it contains scalar/table/metadata tokens. Mark non-numeric prose as invariant only when it is visibly unchanged report wording copied from an example slot. Use phase text only for a non-numeric example state label whose target value comes from targetMetadataKey; never use invariant or phase text for metrics, dates, identifiers, API paths, or table names.
  Aggregate table columns may use a derived case expression over previously declared columns for reusable classifications. Never copy an example classification by entity id.
Bind every scalar slot and every detected table group. Layout bindings may reference only report scalars, report texts, tables, and metadata; raw literal layout values are unavailable by design.
Use metadata tokens in outputFileName when it includes a report period; never copy the requested period into the filename.
Preserve the template's structure. Never invent coordinates, physical paths, SQL, connector calls, writes, or external delivery.
`;

const BUSINESS_REVISION_GOAL = `
Revise a reusable declarative report plan using only completed-example replay evidence.
The previous plan and bounded mismatch/error evidence are diagnostic input, not values to copy. Preserve the source capture contract and use the same generic report schema.
Fix calculation, join, formatting, text-role, or layout bindings so the completed example replays from its captured example-period sources. Never encode expected numbers, dates, entity IDs, table rows, or target values as literals or mappings.
Target-period source rows are unavailable and must not be inferred. All safety, metadata, layout, and source-derivation rules from the original business planner still apply.
`;

export class ReportPlanner {
  private readonly readImage: (path: string) => Uint8Array;
  private readonly maxPlanningChars: number;

  constructor(
    private readonly runner: InvestigationRunner,
    options: ReportPlannerOptions = {},
  ) {
    this.readImage = options.readImage ?? ((path) => readFileSync(path));
    this.maxPlanningChars = options.maxPlanningChars ?? 600_000;
  }

  forExecution(stage: <T>(name: string, input: unknown, run: () => Promise<T>) => Promise<T>): ReportPlanner {
    const runner = this.runner;
    return new ReportPlanner({
      get providerName() { return runner.providerName; },
      async run<T>(request: import('../../agent/investigation-runner.js').InvestigationRunRequest<T>) {
        const result = await stage(request.logContext ?? 'report-inference',
          { version: 1, context: request.context, user: request.user }, async () => {
            const generated = await runner.run(request);
            return { output: generated.output };
          });
        // Persisted wire data must satisfy today's domain contract on resume.
        return { output: request.outputSchema.parse(result.output) };
      },
    }, { readImage: this.readImage, maxPlanningChars: this.maxPlanningChars });
  }

  async inferCapturePlan(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    connectedConnectors: string[];
  }): Promise<ReportCaptureInference> {
    const result = await this.runner.run({
      outputSchema: ReportCaptureInferenceSchema,
      context: {
        skillGoal: SOURCE_PLANNER_GOAL,
        taskGoal: input.goal,
        evidence: [
          { source: 'blank-template', detail: `${input.pair.pageCount} rendered PDF pages` },
          { source: 'completed-example', detail: `${input.pair.scalarSlots.length} scalar slots and ${input.pair.tableGroups.length} table groups` },
          { source: 'source-catalog', detail: `${input.httpConnections.length} HTTP connections and ${input.rdbTables.length} DB tables` },
        ],
        untrustedData: boundedJson({
          reportGeometry: promptPair(input.pair),
          httpConnections: input.httpConnections,
          rdbTables: input.rdbTables,
        }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      user: input.goal,
      images: imagesForPair(input.pair, this.readImage),
      logContext: 'report-source-plan',
    });
    return validateCapturePlan(result.output, input.httpConnections, input.rdbTables);
  }

  async refineCapturePlan(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    provisional: ReportCaptureInference;
    httpProbes: ReportHttpProbe[];
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    connectedConnectors: string[];
  }): Promise<ReportCaptureInference> {
    const result = await this.runner.run({
      outputSchema: ReportCaptureInferenceSchema,
      context: {
        skillGoal: SOURCE_REFINER_GOAL,
        taskGoal: input.goal,
        evidence: [
          { source: 'provisional-source-selection', detail: 'Selected aliases and endpoints are immutable during refinement.' },
          { source: 'http-shape-probe', detail: 'Probe contains JSON types and keys only; source row values are withheld.' },
        ],
        untrustedData: boundedJson({
          reportGeometry: promptPair(input.pair),
          provisional: input.provisional,
          httpProbes: input.httpProbes,
        }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      user: input.goal,
      images: imagesForPair(input.pair, this.readImage),
      logContext: 'report-source-refinement',
    });
    return validateRefinedCapturePlan(
      input.provisional,
      result.output,
      input.httpConnections,
      input.rdbTables,
    );
  }

  async inferReportPlan(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    capture: ReportCaptureInference;
    exampleSources: Record<string, ReportSourceSnapshot>;
    connectedConnectors: string[];
  }): Promise<ReportBusinessInference> {
    const result = await this.runner.run({
      outputSchema: ReportCalculationInferenceSchema,
      context: {
        skillGoal: `${BUSINESS_PLANNER_GOAL}\nThis call produces only reportPlan. Layout and filename bindings are a separate host-validated stage.`,
        taskGoal: input.goal,
        evidence: [
          { source: 'completed-example', detail: 'Every generated value must replay against its discovered dynamic PDF slot.' },
          { source: 'blank-template', detail: 'Only discovered template geometry may be used.' },
          { source: 'captured-example-data', detail: 'Transport completeness and fingerprints do not prove historical or cross-source consistency. Inspect provenance and temporal source fields before inferring period rules.' },
        ],
        untrustedData: boundedJson({
          reportGeometry: promptPair(input.pair),
          examplePeriod: input.capture.examplePeriod,
          targetPeriod: input.capture.targetPeriod,
          capturePlan: input.capture.capturePlan,
          exampleSources: input.exampleSources,
        }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      user: input.goal,
      images: imagesForPair(input.pair, this.readImage),
      logContext: 'report-business-plan',
    });
    return this.inferLayout(input, result.output.reportPlan, 'report-layout-plan');
  }

  private async inferLayout(input: {
    goal: string;
    pair: PdfReportPairAnalysis;
    capture: ReportCaptureInference;
    exampleSources: Record<string, ReportSourceSnapshot>;
    connectedConnectors: string[];
  }, reportPlan: ReportPlan, logContext: string): Promise<ReportBusinessInference> {
    const aliases = new Set([...input.capture.capturePlan.http, ...input.capture.capturePlan.rdb].map((source) => source.alias));
    for (const source of [reportPlan.baseSource, ...reportPlan.joins.map((join) => join.source)]) {
      if (!aliases.has(source)) throw new Error(`report_plan_source_not_captured:${source}`);
    }
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
        skillGoal: 'Bind every discovered scalar slot and table group to the supplied calculated outputs or metadata. Return only the layout schema. Calculation is immutable. Use metadata tokens for period-dependent filenames. Preserve the PDF template; never invent coordinates, literal values, sources or calculations.',
        taskGoal: input.goal,
        evidence: [{ source: 'host-calculated-example', detail: 'Only calculated outputs and metadata are supplied; raw source rows are not needed for layout binding.' }],
        untrustedData: boundedJson({ reportGeometry: promptPair(input.pair), calculated, metadata,
          ...(calculationError ? { calculationError, reportPlan } : {}) }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      user: input.goal,
      images: imagesForPair(input.pair, this.readImage),
      logContext,
    });
    return validateBusinessPlan({ schemaVersion: 1, reportPlan, layout: result.output.layout }, input.capture, input.pair);
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
    const replayFailure = {
      ...(input.replayFailure.executionError
        ? { executionError: input.replayFailure.executionError.slice(0, 300) }
        : {}),
      ...(input.replayFailure.mismatches
        ? {
          mismatches: input.replayFailure.mismatches.slice(0, 40).map((mismatch) => ({
            slotId: mismatch.slotId.slice(0, 200),
            expected: mismatch.expected.slice(0, 500),
            actual: mismatch.actual.slice(0, 500),
          })),
        }
        : {}),
    };
    const result = await this.runner.run({
      outputSchema: ReportCalculationInferenceSchema,
      context: {
        skillGoal: `${BUSINESS_PLANNER_GOAL}\n${BUSINESS_REVISION_GOAL}\nReturn only the calculation plan. Layout is handled separately.`,
        taskGoal: input.goal,
        evidence: [
          { source: 'completed-example-replay', detail: 'Only example-period expected/actual slot evidence is supplied.' },
          { source: 'target-isolation', detail: 'No target-period source snapshot is available during revision.' },
        ],
        untrustedData: boundedJson({
          reportGeometry: promptPair(input.pair),
          examplePeriod: input.capture.examplePeriod,
          targetPeriod: input.capture.targetPeriod,
          capturePlan: input.capture.capturePlan,
          exampleSources: input.exampleSources,
          previous: input.previous,
          replayFailure,
        }, this.maxPlanningChars),
        connectedConnectors: input.connectedConnectors,
      },
      user: input.goal,
      images: imagesForPair(input.pair, this.readImage),
      logContext: 'report-business-plan-revision',
    });
    return this.inferLayout(input, result.output.reportPlan, 'report-layout-plan-revision');
  }
}
