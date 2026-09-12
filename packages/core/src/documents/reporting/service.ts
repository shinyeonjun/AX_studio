import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DocumentEngineClient } from '../read/engine-client.js';
import type { PdfReportPairAnalysis } from '../read/types/pdf.js';
import type { Connector, ConnectorContext, ConnectorResult } from '../../connectors/types.js';
import { parseHttpEndpoints } from '../../connectors/http/connection.js';
import { parseOpenApiConnectionConfig } from '../../connectors/protocols/openapi/connection.js';
import { parseOpenApiSpec, type OpenApiOperation } from '../../connectors/protocols/openapi/parse.js';
import { assertReportSourceCoverage, ReportSourceRequirementsSchema, ReportSourceReplanRequired,
  type ReportSourceNeed, type ReportUnavailableSource, type ReportBusinessInference, type ReportCaptureInference } from './planner/schema.js';
import { repairReportTableCapacities, validateCapturePlan, validateRefinedCapturePlan } from './planner/planner.js';
import { ReportSourceClarificationRequired, type ReportSourceInspection } from './planner/source-discovery.js';
import { inspectReportCatalog } from './planner/catalog.js';
import type { ReportHttpConnectionSummary, ReportPlanReplayFailure } from './planner/planner.js';
import { executeReportPlan } from './plan/execute.js';
import { materializeReportLayout, verifyReportExampleReplay } from './layout/materialize.js';
import { renderReportMetadataTemplate, reportExecutionMetadata } from './period-metadata.js';
import { captureReportSources } from './source/capture.js';
import { probeReportHttpSources, probeReportHttpSourcesWithRecovery, type ReportHttpProbe, type ReportHttpProbeCorrection } from './source/probe.js';
import { normalizeReportHttpPath } from './source/schema.js';
import { ReportCheckpointStore, reportDigest, type ReportCheckpoint } from './checkpoints.js';
import { createHash } from 'node:crypto';

interface ReportWorkspaceSourceResolver {
  resolveStoredFile(sessionId: string, sourceId: string): {
    source: { id: string; fileName: string; mimeType?: string };
    artifact: { storedPath: string };
  };
}

interface ReportPlanningGateway {
  forExecution?(stage: <T>(name: string, input: unknown, run: () => Promise<T>) => Promise<T>): ReportPlanningGateway;
  inferSourceRequirements(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    connectedConnectors: string[];
    unavailableSources?: ReportUnavailableSource[];
  }): Promise<ReportSourceNeed[]>;
  inferCapturePlan(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    connectedConnectors: string[];
    requirements?: ReportSourceNeed[];
    unavailableSources?: ReportUnavailableSource[];
    previousCapture?: ReportCaptureInference;
    inspectSource?: (request: ReportSourceInspection, abortSignal?: AbortSignal) => Promise<unknown>;
  }): Promise<ReportCaptureInference>;
  refineCapturePlan?(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    provisional: ReportCaptureInference;
    httpProbes: ReportHttpProbe[];
    staticQueryCorrections?: ReportHttpProbeCorrection[];
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    connectedConnectors: string[];
  }): Promise<ReportCaptureInference>;
  inferReportPlan(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    capture: ReportCaptureInference;
    exampleSources: Awaited<ReturnType<typeof captureReportSources>>;
    connectedConnectors: string[];
  }): Promise<ReportBusinessInference>;
  reviseReportPlan?(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    capture: ReportCaptureInference;
    exampleSources: Awaited<ReturnType<typeof captureReportSources>>;
    previous: ReportBusinessInference;
    replayFailure: ReportPlanReplayFailure;
    connectedConnectors: string[];
  }): Promise<ReportBusinessInference>;
}

const MAX_REPORT_PLAN_ATTEMPTS = 3;
const REPORT_IDENTITY_CONNECTORS = new Set(['http', 'openapi', 'rdb']);
const VOLATILE_CONNECTION_KEYS = new Set(['connectedAt', 'lastError']);
const SENSITIVE_CONNECTION_KEY = /(?:token|password|secret|authorization|api[-_]?key|connectionstring|private[-_]?key)/iu;

function compareIdentityValues(left: unknown, right: unknown): number {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function reportIdentityValue(value: unknown, key?: string): unknown {
  if (key && VOLATILE_CONNECTION_KEYS.has(key)) return undefined;
  if (key && SENSITIVE_CONNECTION_KEY.test(key)) {
    return { sha256: createHash('sha256').update(JSON.stringify(value) ?? 'undefined').digest('hex') };
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => reportIdentityValue(item))
      .filter((item): item is unknown => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const entry of Object.keys(record).sort()) {
    const normalizedValue = reportIdentityValue(record[entry], entry);
    if (normalizedValue !== undefined) normalized[entry] = normalizedValue;
  }
  return normalized;
}

/**
 * Report checkpoints depend on source availability and authorization shape,
 * not on connection health timestamps or unrelated connector metadata. Secret
 * values still participate through a one-way fingerprint so changing the
 * target or credentials cannot silently reuse evidence from another source.
 */
function reportConnectionIdentity(
  connections: ConnectorContext['connections'],
): unknown[] {
  return (connections ?? [])
    .filter((connection) => REPORT_IDENTITY_CONNECTORS.has(connection.connector))
    .map((connection) => ({
      connector: connection.connector,
      connected: connection.connected,
      config: reportIdentityValue(connection.config),
    }))
    .sort(compareIdentityValues);
}

export interface ReportGenerationDependencies {
  checkpoints?: ReportCheckpointStore;
  workspaceSources: ReportWorkspaceSourceResolver;
  documentEngine: Pick<DocumentEngineClient, 'pdfReportAnalyze' | 'pdfFormFill'>;
  planner: ReportPlanningGateway;
  getConnector(name: string): Connector | undefined;
  /** Test seam; production uses an owned OS temporary directory and cleans it. */
  makeTemporaryDirectory?: () => string;
}

export interface ReportGenerateParams {
  goal: string;
  templateSourceId: string;
  exampleSourceId: string;
  resumeExecutionId?: string;
}

function parseParams(params: Record<string, unknown>): ReportGenerateParams {
  const goal = typeof params.goal === 'string' ? params.goal.trim() : '';
  const templateSourceId = typeof params.templateSourceId === 'string' ? params.templateSourceId.trim() : '';
  const exampleSourceId = typeof params.exampleSourceId === 'string' ? params.exampleSourceId.trim() : '';
  if (!goal) throw new Error('report_goal_required');
  if (!templateSourceId) throw new Error('report_template_source_required');
  if (!exampleSourceId) throw new Error('report_example_source_required');
  if (templateSourceId === exampleSourceId) throw new Error('report_sources_must_differ');
  const resumeExecutionId = typeof params.resumeExecutionId === 'string' ? params.resumeExecutionId.trim() : undefined;
  if (resumeExecutionId && resumeExecutionId.length > 160) throw new Error('report_resume_id_invalid');
  return { goal, templateSourceId, exampleSourceId, ...(resumeExecutionId ? { resumeExecutionId } : {}) };
}

function safePdfFileName(value: string): string {
  const name = basename(value).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  if (!name || name === '.pdf') return 'generated-report.pdf';
  return name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`;
}

function httpConnectionSummaries(ctx: ConnectorContext): ReportHttpConnectionSummary[] {
  const config = ctx.connections?.find((connection) => connection.connector === 'http' && connection.connected)?.config;
  const documented = ctx.connections?.find((connection) => connection.connector === 'openapi' && connection.connected);
  let operationSource: { origin: string; basePath: string; operations: OpenApiOperation[] } | undefined;
  try {
    const openapi = parseOpenApiConnectionConfig(documented?.config);
    if (openapi) {
      const url = new URL(openapi.baseUrl);
      const spec = parseOpenApiSpec(openapi.specId, openapi.specJson);
      operationSource = { origin: url.origin, basePath: url.pathname.replace(/\/$/, ''),
        operations: spec.operations.filter(operation => operation.method === 'GET'
          && operation.sideEffect === 'NONE'
          && !/[{}?#]/.test(operation.path)
          && normalizeReportHttpPath(operation.path) === operation.path) };
    }
  } catch {
    // An invalid or unsupported spec cannot authorize a route inspection.
  }
  return parseHttpEndpoints(config).flatMap((endpoint) => {
    try {
      const url = new URL(endpoint.baseUrl);
      const operations = operationSource?.origin === url.origin
        && operationSource.basePath === url.pathname.replace(/\/$/, '') ? operationSource.operations : [];
      return [{ id: endpoint.id, label: endpoint.label?.trim() || endpoint.id, origin: url.origin, basePath: url.pathname || '/',
        ...(operations.length ? { operations } : {}) }];
    } catch {
      return [];
    }
  });
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error &&
      typeof error.code === 'string' &&
      ['vision_unavailable', 'image_format_unsupported', 'image_input_empty', 'model_output_invalid', 'agent_timeout', 'agent_aborted'].includes(error.code)) {
    return error.code;
  }
  const raw = error instanceof Error ? error.message : String(error);
  const code = raw.split(':', 1)[0] || 'report_generation_failed';
  return /^[a-z][a-z0-9_.-]{0,96}$/i.test(code) ? code : 'report_generation_failed';
}

function safeErrorData(error: unknown): Record<string, unknown> {
  if (error instanceof ReportSourceClarificationRequired) return { clarification: error.clarification.slice(0, 1000) };
  if (!error || typeof error !== 'object' || !('issues' in error) || !Array.isArray(error.issues)) return {};
  const issues = error.issues
    .filter((issue): issue is { code: string; path: unknown[] } => (
      !!issue && typeof issue === 'object' &&
      'code' in issue && typeof issue.code === 'string' &&
      'path' in issue && Array.isArray(issue.path)
    ))
    .slice(0, 12)
    .map((issue) => ({ code: issue.code, path: issue.path.slice(0, 12) }));
  return issues.length ? { validationIssues: issues } : {};
}

function httpInspectionFailure(error: unknown): { reason: string; status?: number; errorCode?: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const status = /^report_http_probe_status:[^:]+:(\d{3})$/.exec(raw)?.[1];
  if (status) return { reason: 'http_status', status: Number(status) };
  const connectorCode = /^report_http_probe_failed:[^:]+:([a-z][a-z0-9_.-]{0,96})$/i.exec(raw)?.[1];
  if (connectorCode) return { reason: 'http_probe_failed', errorCode: connectorCode };
  if (/^report_http_probe_(?:incomplete|not_json|response_invalid):/.test(raw)) {
    return { reason: 'http_response_invalid' };
  }
  return { reason: 'http_probe_failed' };
}

function reportHttpEvidencePathnames(goal: string, pair: PdfReportPairAnalysis): Set<string> {
  const texts = [
    goal,
    ...pair.scalarSlots.map((slot) => slot.exampleText),
    ...pair.tableGroups.flatMap((group) => group.rows.flatMap((row) => row.cells.map((cell) => cell.exampleText))),
  ];
  const pathnames = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(/\/(?!\/)[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%\/-]{0,255}/g)) {
      const token = match[0];
      let prosePath = token.replace(/[.,;:']+$/, '');
      while (prosePath.endsWith(')') && prosePath.split(')').length > prosePath.split('(').length) {
        prosePath = prosePath.slice(0, -1);
      }
      // Keep the literal route too: punctuation can be a real URL character.
      for (const candidate of new Set([token, prosePath])) {
        try {
          const normalized = normalizeReportHttpPath(candidate);
          pathnames.add(new URL(normalized, 'http://report-probe.invalid').pathname);
        } catch {
          // A slash in prose is not evidence of a request route.
        }
      }
    }
  }
  return pathnames;
}

export class ReportGenerationService {
  constructor(private readonly dependencies: ReportGenerationDependencies) {}

  async generate(rawParams: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    let phase = 'prepare';
    let outputDirectory: string | undefined;
    let checkpoint: ReportCheckpoint | undefined;
    let resumeAvailable = false;
    const saveCheckpoint = () => {
      if (checkpoint && ctx.workspaceSessionId && ctx.executionId) {
        this.dependencies.checkpoints?.write(ctx.workspaceSessionId, ctx.executionId, checkpoint);
      }
    };
    const stage = async <T>(name: string, input: unknown, run: () => Promise<T>, reusable: (value: T) => boolean = () => true): Promise<T> => {
      if (ctx.abortSignal?.aborted) throw new Error('agent_aborted');
      phase = name;
      const started = Date.now();
      const digest = reportDigest(input);
      const saved = checkpoint?.stages[name];
      if (saved?.digest === digest && reusable(saved.value as T)) {
        ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_stage_resumed',
          message: '저장된 중간 결과를 사용합니다.', data: { phase: name } });
        return saved.value as T;
      }
      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_stage_started',
        message: '보고서 처리 단계를 시작합니다.', data: { phase: name } });
      const value = await run();
      if (ctx.abortSignal?.aborted) throw new Error('agent_aborted');
      if (checkpoint) {
        checkpoint.stages[name] = { digest, value };
        saveCheckpoint();
      }
      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_stage_completed',
        message: '보고서 처리 단계를 마쳤습니다.', data: { phase: name, durationMs: Date.now() - started } });
      return value;
    };
    const ownsTemporaryDirectory = !this.dependencies.makeTemporaryDirectory;
    try {
      const params = parseParams(rawParams);
      const planner = this.dependencies.planner.forExecution?.(stage) ?? this.dependencies.planner;
      if (!ctx.workspaceSessionId) throw new Error('report_workspace_session_required');
      if (!ctx.artifactSink) throw new Error('report_artifact_sink_required');

      const template = this.dependencies.workspaceSources.resolveStoredFile(ctx.workspaceSessionId, params.templateSourceId);
      const example = this.dependencies.workspaceSources.resolveStoredFile(ctx.workspaceSessionId, params.exampleSourceId);
      if (!template.source.fileName.toLowerCase().endsWith('.pdf')) throw new Error('report_template_pdf_required');
      if (!example.source.fileName.toLowerCase().endsWith('.pdf')) throw new Error('report_example_pdf_required');

      if (params.resumeExecutionId && !this.dependencies.checkpoints) throw new Error('report_resume_unavailable');
      if (this.dependencies.checkpoints) {
        const fileHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
        const identity = reportDigest({ version: 1, goal: params.goal,
          template: fileHash(template.artifact.storedPath), example: fileHash(example.artifact.storedPath),
          connections: reportConnectionIdentity(ctx.connections),
        });
        const previous = params.resumeExecutionId
          ? this.dependencies.checkpoints.read(ctx.workspaceSessionId, params.resumeExecutionId) : undefined;
        if (params.resumeExecutionId && !previous) throw new Error('report_checkpoint_not_found');
        if (previous && previous.identity !== identity) throw new Error('report_checkpoint_input_changed');
        if (previous && previous.status !== 'failed') throw new Error('report_checkpoint_not_failed');
        checkpoint = { version: 1, identity, status: 'running', stages: previous?.stages ?? {} };
        saveCheckpoint();
      }

      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_pair_analysis_started', message: '보고서 양식과 완성 예시를 비교하고 있습니다.' });
      phase = 'pair_analysis';
      const pair = await stage('pair_analysis', { version: 2, template: params.templateSourceId, example: params.exampleSourceId }, () => this.dependencies.documentEngine.pdfReportAnalyze(
        template.artifact.storedPath,
        example.artifact.storedPath,
      ), (saved) => [...saved.templateImages, ...saved.exampleImages].every(existsSync));
      const reportEvidencePathnames = reportHttpEvidencePathnames(params.goal, pair);

      const rdb = this.dependencies.getConnector('rdb');
      phase = 'rdb_schema';
      let rdbTables: string[] = [];
      const unavailableSources: ReportUnavailableSource[] = [];
      if (rdb) {
        let schema: ConnectorResult;
        try {
          schema = await rdb.execute('schema.describe', {}, ctx);
        } catch (error) {
          if (ctx.abortSignal?.aborted || errorCode(error) === 'agent_aborted') throw error;
          schema = { ok: false, errorCode: 'connector_exception' };
        }
        if (ctx.abortSignal?.aborted || schema.errorCode === 'aborted') throw new Error('agent_aborted');
        if (!schema.ok) {
          const code = schema.errorCode ?? '';
          unavailableSources.push({ connector: 'rdb', operation: 'schema.describe', available: false,
            reason: 'schema_request_failed', errorCode: ['rdb_error', 'policy_denied', 'timeout', 'connector_exception'].includes(code) ? code : 'rdb_error' });
        } else if (!Array.isArray(schema.data) || !schema.data.every((value) => typeof value === 'string')) {
          unavailableSources.push({ connector: 'rdb', operation: 'schema.describe', available: false, reason: 'schema_response_invalid' });
        } else {
          rdbTables = schema.data;
        }
      } else {
        unavailableSources.push({ connector: 'rdb', operation: 'schema.describe', available: false, reason: 'connector_missing' });
      }
      const httpConnections = httpConnectionSummaries(ctx);
      const assertHttpSourcePath = (request: { connectionId?: unknown; path?: unknown }) => {
        const connection = httpConnections.find(item => item.id === request.connectionId);
        if (!connection || typeof request.path !== 'string') throw new Error('report_source_inspection_denied');
        const pathname = new URL(normalizeReportHttpPath(request.path), 'http://report-probe.invalid').pathname;
        if (!reportEvidencePathnames.has(pathname) &&
          !connection.operations?.some(operation => operation.path === pathname)) {
          throw new Error('report_http_path_not_in_report_evidence');
        }
      };
      const connectedConnectors = ['document', ...(httpConnections.length ? ['http'] : []), ...(rdb ? ['rdb'] : [])];
      const gateway = {
        executeHttp: async (request: Record<string, unknown>, executionContext = ctx) => {
          assertHttpSourcePath(request);
          const connector = this.dependencies.getConnector('http');
          return connector
            ? connector.execute('request', request, executionContext)
            : { ok: false, error: 'http connector missing', errorCode: 'connector_missing' };
        },
        executeRdb: async (request: Record<string, unknown>) => {
          const connector = this.dependencies.getConnector('rdb');
          return connector
            ? connector.execute('query.read', request, { ...ctx, reportCapture: true })
            : { ok: false, error: 'rdb connector missing', errorCode: 'connector_missing' };
        },
      };

      phase = 'source_requirements';
      const requiredSources = await stage('source_requirements', { version: 2, goal: params.goal, pair, unavailableSources },
        () => planner.inferSourceRequirements({ goal: params.goal, pair, connectedConnectors, unavailableSources }));
      const initialRequirements = ReportSourceRequirementsSchema.parse({ schemaVersion: 1, requirements: requiredSources }).requirements;
      const planned = await (async () => {
        let requirements = initialRequirements;
        let previousCapture: ReportCaptureInference | undefined;
        let capturedSelection: string | undefined;
        const seen = new Set<string>();
        for (let sourceAttempt = 0; sourceAttempt < 3; sourceAttempt++) {
          const sourceStage = <T>(name: string, input: unknown, run: () => Promise<T>) =>
            stage(sourceAttempt === 0 ? name : `${name}-sources-${sourceAttempt}`, input, run);
          const sourcePlanner = this.dependencies.planner.forExecution?.(sourceStage) ?? planner;
          try {
            phase = 'source_plan';
            if (unavailableSources.length && requirements.some(need => need.connector === 'rdb')) {
              throw new Error('report_rdb_schema_failed');
            }
            ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_source_plan_started', message: '보고서에 필요한 데이터 조회 방법을 구성하고 있습니다.' });
            const proposed = await sourceStage('source_plan', { version: 6, pair, httpConnections, rdbTables, requirements, previousCapture, unavailableSources }, () => sourcePlanner.inferCapturePlan({
              goal: params.goal,
              pair,
              httpConnections,
              rdbTables,
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
                  return inspectReportCatalog(httpConnections, rdbTables, request);
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
            }));
            if (unavailableSources.length && proposed.capturePlan.rdb.length) throw new Error('report_rdb_schema_failed');
            const provisionalCapture = validateCapturePlan(proposed, httpConnections, rdbTables);
            provisionalCapture.capturePlan.http.forEach(assertHttpSourcePath);
            if (capturedSelection === reportDigest(provisionalCapture.capturePlan)) throw new Error('report_source_replan_no_progress');
            if (previousCapture) {
              if (reportDigest(provisionalCapture.examplePeriod) !== reportDigest(previousCapture.examplePeriod)
                || reportDigest(provisionalCapture.targetPeriod) !== reportDigest(previousCapture.targetPeriod)) {
                throw new Error('report_source_replan_period_changed');
              }
              for (const kind of ['http', 'rdb'] as const) {
                for (const source of previousCapture.capturePlan[kind]) {
                  const candidates = provisionalCapture.capturePlan[kind].filter(candidate => candidate.alias === source.alias);
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
              phase = 'http_probe';
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
              phase = 'source_refinement';
              capture = await sourceStage('source_refinement', { provisionalCapture: refinementProvisional,
                httpProbes: probeResult.probes, corrections: probeResult.corrections }, () => sourcePlanner.refineCapturePlan!({
                goal: params.goal,
                pair,
                provisional: refinementProvisional,
                httpProbes: probeResult.probes,
                staticQueryCorrections: probeResult.corrections,
                httpConnections,
                rdbTables,
                connectedConnectors,
              }));
            }
            // Shape refinement must not silently erase the validated requirement bindings.
            capture = { ...validateRefinedCapturePlan(refinementProvisional, capture, httpConnections, rdbTables),
              requirementBindings: provisionalCapture.requirementBindings };
            capture.capturePlan.http.forEach(assertHttpSourcePath);
            assertReportSourceCoverage(capture, requirements);
            previousCapture = capture;

            ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_example_capture_started', message: '완성 예시 기간의 연결 데이터를 검증하고 있습니다.' });
            phase = 'example_capture';
            const exampleSources = await sourceStage('example_capture', capture, () => captureReportSources(capture.capturePlan, capture.examplePeriod, gateway));
            capturedSelection = reportDigest(capture.capturePlan);
            phase = 'business_plan';
            ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_business_plan_started', message: '예시 보고서의 계산 기준과 양식 배치를 구성하고 있습니다.' });
            const business = await sourceStage('business_plan', { pair, capture, exampleSources }, () => sourcePlanner.inferReportPlan({
              goal: params.goal,
              pair,
              capture,
              exampleSources,
              connectedConnectors,
            }));
            return { capture, exampleSources, business };
          } catch (error) {
            if (!(error instanceof ReportSourceReplanRequired)) throw error;
            phase = 'source_plan';
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
      })();
      const { capture, exampleSources } = planned;
      let { business } = planned;
      const exampleMetadata = reportExecutionMetadata(
        capture.examplePeriod,
        capture.capturePlan,
        'example',
      );
      let verifiedSlots = 0;
      for (let attempt = 1; attempt <= MAX_REPORT_PLAN_ATTEMPTS; attempt += 1) {
        phase = 'example_replay';
        let replayFailure: ReportPlanReplayFailure | undefined;
        try {
          const exampleResult = executeReportPlan(
            business.reportPlan,
            exampleSources,
            exampleMetadata,
          );
          const exampleLayout = materializeReportLayout(
            pair,
            business.layout,
            exampleResult,
            exampleMetadata,
          );
          const replay = verifyReportExampleReplay(pair, exampleLayout.values);
          if (replay.ok) {
            verifiedSlots = Object.keys(exampleLayout.values).length;
            break;
          }
          replayFailure = { mismatches: replay.mismatches };
        } catch (error) {
          const code = errorCode(error);
          if (!code.startsWith('report_')) throw error;
          replayFailure = { executionError: code };
        }

        const mayRevise = attempt < MAX_REPORT_PLAN_ATTEMPTS && planner.reviseReportPlan?.bind(planner);
        if (!mayRevise) {
          ctx.log({
            at: new Date().toISOString(), level: 'warn', code: 'report_example_replay_failed',
            message: '완성 예시의 계산 기준을 재현하지 못해 보고서 생성을 중단했습니다.',
            data: {
              attempt,
              mismatchCount: replayFailure.mismatches?.length ?? 0,
              mismatches: replayFailure.mismatches?.slice(0, 12) ?? [],
              executionError: replayFailure.executionError,
            },
          });
          throw new Error('report_example_replay_failed');
        }
        ctx.log({
          at: new Date().toISOString(), level: 'info', code: 'report_plan_revision_started',
          message: '완성 예시와 다른 계산·배치를 다시 검토하고 있습니다.',
          data: { attempt: attempt + 1, mismatchCount: replayFailure.mismatches?.length ?? 0 },
        });
        phase = 'business_revision';
        business = await stage(`business_revision_${attempt}`, { pair, capture, exampleSources, business, replayFailure }, () => mayRevise({
          goal: params.goal,
          pair,
          capture,
          exampleSources,
          previous: business,
          replayFailure,
          connectedConnectors,
        }));
      }
      if (verifiedSlots === 0) throw new Error('report_example_replay_failed');
      ctx.log({
        at: new Date().toISOString(), level: 'info', code: 'report_example_replay_passed',
        message: '완성 예시의 계산 기준과 양식 배치를 재현했습니다.',
        data: { verifiedSlots },
      });

      phase = 'target_capture';
      const targetSources = await stage('target_capture', capture, () => captureReportSources(capture.capturePlan, capture.targetPeriod, gateway));
      const targetMetadata = reportExecutionMetadata(
        capture.targetPeriod,
        capture.capturePlan,
        'target',
      );
      phase = 'target_calculation';
      // A resumed checkpoint can contain a plan produced before the host
      // separated example layout capacity from semantic table limits. Apply
      // the same structural repair at the target boundary so cached plans
      // cannot reintroduce the old silent truncation.
      const targetReportPlan = repairReportTableCapacities(
        business.reportPlan,
        business.layout,
        pair,
      );
      const targetResult = executeReportPlan(
        targetReportPlan,
        targetSources,
        targetMetadata,
      );
      const outputFileName = renderReportMetadataTemplate(business.layout.outputFileName, targetMetadata);
      const targetLayout = materializeReportLayout(
        pair,
        { ...business.layout, outputFileName },
        targetResult,
        targetMetadata,
      );
      outputDirectory = this.dependencies.makeTemporaryDirectory?.() ?? mkdtempSync(join(tmpdir(), 'ax-report-'));
      mkdirSync(outputDirectory, { recursive: true });
      const fileName = safePdfFileName(outputFileName);
      const outputPath = join(outputDirectory, fileName);
      phase = 'pdf_render';
      const filled = await this.dependencies.documentEngine.pdfFormFill(template.artifact.storedPath, {
        template: targetLayout.template,
        values: targetLayout.values,
        outputPath,
      });
      if (!filled.verified || !existsSync(filled.outputPath)) throw new Error('report_pdf_verification_failed');
      phase = 'artifact_store';
      const artifact = ctx.artifactSink.putBytes(readFileSync(filled.outputPath), {
        fileName,
        mimeType: 'application/pdf',
      });
      ctx.log({
        at: new Date().toISOString(), level: 'info', code: 'pdf_generated',
        message: '보고서 PDF를 생성했습니다.',
        data: {
          artifactId: artifact.id,
          fileName: artifact.fileName,
          size: artifact.size,
          mimeType: artifact.mimeType,
          pageCount: filled.pageCount,
          exampleReplayVerified: true,
          sourceFingerprints: Object.fromEntries(Object.entries(targetSources).map(([id, source]) => [id, source.fingerprint])),
        },
      });
      if (checkpoint) {
        checkpoint.status = 'completed';
        try { saveCheckpoint(); } catch {
          ctx.log({ at: new Date().toISOString(), level: 'warn', code: 'report_checkpoint_save_failed', message: 'PDF는 생성했으나 중간 기록의 완료 상태 저장에 실패했습니다.' });
        }
      }
      return {
        ok: true,
        data: {
          artifact,
          pageCount: filled.pageCount,
          exampleReplayVerified: true,
          examplePeriod: capture.examplePeriod.label,
          targetPeriod: capture.targetPeriod.label,
        },
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'phase' in error && typeof error.phase === 'string'
          && /^report-[a-z-]{1,80}$/.test(error.phase)) phase = error.phase;
      if (checkpoint) {
        checkpoint.status = 'failed';
        try { saveCheckpoint(); resumeAvailable = Boolean(ctx.executionId); } catch {
          ctx.log({ at: new Date().toISOString(), level: 'warn', code: 'report_checkpoint_save_failed', message: '재시도용 중간 결과를 저장하지 못했습니다.' });
        }
      }
      const code = errorCode(error);
      ctx.log({
        at: new Date().toISOString(), level: 'error', code,
        message: error instanceof Error ? error.message : String(error),
        data: { phase, ...safeErrorData(error), ...(resumeAvailable ? { resumeAvailable: true } : {}) },
      });
      return { ok: false, error: code, errorCode: code, errorDetails: { phase, ...safeErrorData(error) } };
    } finally {
      if (ownsTemporaryDirectory && outputDirectory) rmSync(outputDirectory, { recursive: true, force: true });
    }
  }
}
