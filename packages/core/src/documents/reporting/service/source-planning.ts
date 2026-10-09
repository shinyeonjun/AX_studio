import type { Connector, ConnectorContext, ConnectorResult } from '../../../connectors/types.js';
import type { DocumentEngineClient } from '../../read/engine-client.js';
import {
  assertReportSourceCoverage,
  ReportSourceRequirementsSchema,
  ReportSourceReplanRequired,
  type ReportCaptureInference,
  type ReportSourceNeed,
  type ReportUnavailableSource,
} from '../planner/schema.js';
import {
  validateCapturePlan,
  validateRefinedCapturePlan,
  type ReportFileSummary,
  type ReportHttpConnectionSummary,
} from '../planner/planner.js';
import { TableArtifactSchema } from '../../../contracts/artifacts/table.js';
import { inspectReportCatalog } from '../planner/catalog.js';
import { captureReportSources } from '../source/capture.js';
import { probeReportHttpSources, probeReportHttpSourcesWithRecovery } from '../source/probe.js';
import { normalizeReportHttpPath, type ReportSourceGateway } from '../source/schema.js';
import { reportDigest } from '../checkpoints.js';
import type { ReportGenerationDependencies } from './contracts.js';
import { httpInspectionFailure } from './http-sources.js';
import { errorCode } from './errors.js';

type ReportPlanningGateway = ReportGenerationDependencies['planner'];

interface ReportServiceSourceGateway extends ReportSourceGateway {
  executeHttp(params: Record<string, unknown>, executionContext?: ConnectorContext): Promise<ConnectorResult>;
}

interface ReportSourcePlanningOptions {
  ctx: ConnectorContext;
  goal: string;
  pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
  /** Checkpointed stage runner owned by the generation run. */
  stage: <T>(name: string, input: unknown, run: () => Promise<T>) => Promise<T>;
  /** The run keeps the failing phase for its error report. */
  setPhase: (phase: string) => void;
  planner: ReportPlanningGateway;
  /** Unwrapped planner, re-bound to a per-attempt stage on every replan. */
  basePlanner: ReportPlanningGateway;
  rdb: Connector | undefined;
  rdbTables: string[];
  unavailableSources: ReportUnavailableSource[];
  httpConnections: ReportHttpConnectionSummary[];
  /** CSV/xlsx files in connected folders that a report may read. */
  files?: ReportFileSummary[];
  reportEvidencePathnames: Set<string>;
  assertHttpSourcePath: (request: { connectionId?: unknown; path?: unknown }) => void;
  connectedConnectors: string[];
  gateway: ReportServiceSourceGateway;
  initialRequirements: ReportSourceNeed[];
}

/**
 * Plan, probe and capture the example-period sources, then infer the business
 * plan. A missing-source signal from the planner replans within the authorized
 * connections (at most three attempts) while keeping periods, aliases and DB
 * tables stable, so a replan cannot silently change the reported population.
 */
export async function planReportSources(options: ReportSourcePlanningOptions) {
  const {
    ctx, goal, pair, stage, setPhase, planner, basePlanner, rdb, rdbTables, unavailableSources,
    httpConnections, reportEvidencePathnames, assertHttpSourcePath, connectedConnectors, gateway,
    initialRequirements,
  } = options;
  const files = options.files ?? [];
  let requirements = initialRequirements;
  let previousCapture: ReportCaptureInference | undefined;
  let capturedSelection: string | undefined;
  const seen = new Set<string>();
  for (let sourceAttempt = 0; sourceAttempt < 3; sourceAttempt++) {
    const sourceStage = <T>(name: string, input: unknown, run: () => Promise<T>) =>
      stage(sourceAttempt === 0 ? name : `${name}-sources-${sourceAttempt}`, input, run);
    const sourcePlanner = basePlanner.forExecution?.(sourceStage) ?? planner;
    try {
      setPhase('source_plan');
      if (unavailableSources.length && requirements.some(need => need.connector === 'rdb')) {
        throw new Error('report_rdb_schema_failed');
      }
      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_source_plan_started', message: '보고서에 필요한 데이터 조회 방법을 구성하고 있습니다.' });
      const proposed = await sourceStage('source_plan', { version: 6, pair, httpConnections, rdbTables, files, requirements, previousCapture, unavailableSources }, () => sourcePlanner.inferCapturePlan({
        goal,
        pair,
        httpConnections,
        rdbTables,
        files,
        unavailableSources,
        inspectSource: async (request, abortSignal) => {
          const inspectionSignal = abortSignal && ctx.abortSignal
            ? AbortSignal.any([abortSignal, ctx.abortSignal]) : abortSignal ?? ctx.abortSignal;
          const inspectionContext = { ...ctx, abortSignal: inspectionSignal };
          const checkAborted = () => {
            if (inspectionSignal?.aborted) throw new Error('agent_aborted');
          };
          checkAborted();
          if (request.kind === 'catalog' || request.kind === 'http_operation') {
            return inspectReportCatalog(httpConnections, rdbTables, request, files);
          }
          const inspectStage = <T>(run: () => Promise<T>) => sourceStage(`source-inspection-${reportDigest(request)}`, request, async () => {
            checkAborted();
            const result = await run();
            // A connector may settle after the discovery deadline. Do not
            // let late evidence mutate the failed execution's checkpoint.
            checkAborted();
            return result;
          });
          if (request.kind === 'rdb_table') {
            if (!rdb || !rdbTables.includes(request.table)) throw new Error('report_source_inspection_denied');
            return inspectStage(async () => {
              const result = await rdb.execute('table.describe', {
                table: request.table, offset: request.offset ?? 0, limit: request.limit ?? 20,
              }, inspectionContext);
              return result.ok ? result.data : { available: false, reason: 'table_metadata_unavailable' };
            });
          }
          if (request.kind === 'file_sheet') {
            if (!gateway.executeFile || !files.some(file => file.folderId === request.folderId && file.path === request.path)) {
              throw new Error('report_source_inspection_denied');
            }
            const readFile = gateway.executeFile;
            // Like a DB table's description: its columns and how many rows, never the values.
            return inspectStage(async () => {
              const result = await readFile({ folderId: request.folderId, path: request.path, ...(request.sheet ? { sheet: request.sheet } : {}) });
              const table = result.ok ? TableArtifactSchema.safeParse(result.data) : undefined;
              return table?.success
                ? { folderId: request.folderId, path: request.path, ...(request.sheet ? { sheet: request.sheet } : {}),
                  columns: table.data.columns.map(column => ({ name: column.name, type: column.type })),
                  rowCount: table.data.rows.length }
                : { available: false, reason: result.ok ? 'sheet_unreadable' : result.errorCode ?? 'sheet_unreadable' };
            });
          }
          const connection = httpConnections.find(item => item.id === request.connectionId);
          if (!connection) throw new Error('report_source_inspection_denied');
          return inspectStage(async () => {
            const path = normalizeReportHttpPath(request.path);
            const pathname = new URL(path, 'http://report-probe.invalid').pathname;
            if (!reportEvidencePathnames.has(pathname)
              && !connection.operations?.some(operation => operation.path === pathname)) {
              ctx.log({ at: new Date().toISOString(), level: 'warn', code: 'report_http_inspection_skipped',
                message: '보고서 근거에 없는 HTTP 경로는 확인하지 않습니다.',
                data: { connectionId: connection.id, path, reason: 'http_path_not_in_report_evidence' } });
              return { available: false, connectionId: connection.id, path,
                reason: 'http_path_not_in_report_evidence' };
            }
            try {
              return await probeReportHttpSources({ schemaVersion: 1, rdb: [], http: [{
                alias: 'inspection', connectionId: connection.id, path, rowsPath: '$',
              }] }, { executeHttp: request => gateway.executeHttp(request, inspectionContext) });
            } catch (error) {
              if (errorCode(error) === 'agent_aborted') throw error;
              const failure = httpInspectionFailure(error);
              ctx.log({ at: new Date().toISOString(), level: 'warn', code: 'report_http_inspection_failed',
                message: '선택된 HTTP 경로의 구조 확인에 실패했습니다.',
                data: { connectionId: connection.id, path, ...failure } });
              return { available: false, connectionId: connection.id, path, ...failure };
            }
          });
        },
        connectedConnectors,
        requirements,
        previousCapture,
        signal: ctx.abortSignal,
        log: ctx.log,
      }));
      if (unavailableSources.length && proposed.capturePlan.rdb.length) throw new Error('report_rdb_schema_failed');
      const provisionalCapture = validateCapturePlan(proposed, httpConnections, rdbTables, files);
      provisionalCapture.capturePlan.http.forEach(assertHttpSourcePath);
      if (capturedSelection === reportDigest(provisionalCapture.capturePlan)) throw new Error('report_source_replan_no_progress');
      if (previousCapture) {
        if (reportDigest(provisionalCapture.examplePeriod) !== reportDigest(previousCapture.examplePeriod)
          || reportDigest(provisionalCapture.targetPeriod) !== reportDigest(previousCapture.targetPeriod)) {
          throw new Error('report_source_replan_period_changed');
        }
        for (const kind of ['http', 'rdb', 'file'] as const) {
          for (const source of previousCapture.capturePlan[kind] ?? []) {
            const candidates = (provisionalCapture.capturePlan[kind] ?? []).filter(candidate => candidate.alias === source.alias);
            // A replan may recover from a source that was authorized but
            // structurally insufficient. Keep the logical alias stable
            // while allowing an HTTP connection/path to be replaced by
            // another authorized candidate. Physical DB tables remain
            // pinned because changing one would silently change the
            // business population being reported.
            const preserved = kind === 'http'
              ? candidates.length === 1
              : candidates.some(candidate => reportDigest(candidate) === reportDigest(source));
            if (!preserved) {
              throw new Error('report_source_replan_selection_changed');
            }
          }
        }
      }
      const selection = reportDigest({ plan: provisionalCapture.capturePlan, bindings: provisionalCapture.requirementBindings });
      if (seen.has(selection)) throw new Error('report_source_replan_no_progress');
      seen.add(selection);
      previousCapture = provisionalCapture;
      assertReportSourceCoverage(provisionalCapture, requirements);
      let capture = provisionalCapture;
      let refinementProvisional = provisionalCapture;
      if (provisionalCapture.capturePlan.http.length > 0) {
        if (!sourcePlanner.refineCapturePlan) throw new Error('report_http_refiner_unavailable');
        ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_http_probe_started', message: '선택된 API의 응답 구조를 읽기 전용으로 확인하고 있습니다.' });
        setPhase('http_probe');
        for (const source of provisionalCapture.capturePlan.http) {
          const connection = httpConnections.find(item => item.id === source.connectionId);
          ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_http_source_selected',
            message: '구조 확인에 사용할 HTTP 연결을 선택했습니다.',
            data: { alias: source.alias, connectionId: source.connectionId, origin: connection?.origin } });
        }
        const probeResult = await sourceStage('http_probe', provisionalCapture.capturePlan, () =>
          probeReportHttpSourcesWithRecovery(provisionalCapture.capturePlan, gateway));
        refinementProvisional = { ...provisionalCapture, capturePlan: probeResult.plan };
        for (const correction of probeResult.corrections) {
          ctx.log({ at: new Date().toISOString(), level: 'warn', code: 'report_http_static_query_removed',
            message: 'API가 거부한 정적 필터를 제거하고 같은 경로를 다시 확인했습니다.',
            data: { alias: correction.alias, status: correction.status, queryKeys: correction.queryKeys } });
        }
        setPhase('source_refinement');
        capture = await sourceStage('source_refinement', { provisionalCapture: refinementProvisional,
          httpProbes: probeResult.probes, corrections: probeResult.corrections }, () => sourcePlanner.refineCapturePlan!({
          goal,
          pair,
          provisional: refinementProvisional,
          httpProbes: probeResult.probes,
          staticQueryCorrections: probeResult.corrections,
          httpConnections,
          rdbTables,
          files,
          connectedConnectors,
          signal: ctx.abortSignal,
          log: ctx.log,
        }));
      }
      // Shape refinement must not silently erase the validated requirement bindings.
      capture = { ...validateRefinedCapturePlan(refinementProvisional, capture, httpConnections, rdbTables, files),
        requirementBindings: provisionalCapture.requirementBindings };
      capture.capturePlan.http.forEach(assertHttpSourcePath);
      assertReportSourceCoverage(capture, requirements);
      previousCapture = capture;

      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_example_capture_started', message: '완성 예시 기간의 연결 데이터를 검증하고 있습니다.' });
      setPhase('example_capture');
      const exampleSources = await sourceStage('example_capture', capture, () => captureReportSources(
        capture.capturePlan, capture.examplePeriod, gateway, {}, capture.examplePeriod));
      capturedSelection = reportDigest(capture.capturePlan);
      setPhase('business_plan');
      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_business_plan_started', message: '예시 보고서의 계산 기준과 양식 배치를 구성하고 있습니다.' });
      const business = await sourceStage('business_plan', { pair, capture, exampleSources }, () => sourcePlanner.inferReportPlan({
        goal,
        pair,
        capture,
        exampleSources,
        connectedConnectors,
      }));
      return { capture, exampleSources, business };
    } catch (error) {
      if (!(error instanceof ReportSourceReplanRequired)) throw error;
      setPhase('source_plan');
      ctx.log({ at: new Date().toISOString(), level: 'warn', code: 'report_source_replan_required',
        message: '필요한 원천 데이터가 누락되어 허용된 연결 안에서 조회 계획을 다시 구성합니다.',
        data: { attempt: sourceAttempt + 1, missingSourceCount: error.needs.length,
          missingConnectorTypes: [...new Set(error.needs.map(need => need.connector))] } });
      if (sourceAttempt === 2) throw new Error('report_source_replan_limit');
      // New semantic needs cannot replace or weaken the original requirements.
      const additions = error.needs.filter(need => !requirements.some(existing =>
        existing.connector === need.connector && existing.description === need.description && existing.reason === need.reason));
      requirements = ReportSourceRequirementsSchema.parse({ schemaVersion: 1,
        requirements: [...requirements, ...additions.map((need, index) => ({ ...need,
          id: `additional-${sourceAttempt}-${index}` }))] }).requirements;
    }
  }
  throw new Error('report_source_replan_limit');
}
