import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DocumentEngineClient } from '../document-engine/engine-client.js';
import type { Connector, ConnectorContext, ConnectorResult } from '../modules/types.js';
import { parseHttpEndpoints } from '../modules/http/connection.js';
import type { ReportBusinessInference, ReportCaptureInference } from './planner/schema.js';
import type { ReportHttpConnectionSummary, ReportPlanReplayFailure } from './planner/planner.js';
import { executeReportPlan } from './plan/execute.js';
import { materializeReportLayout, verifyReportExampleReplay } from './layout/materialize.js';
import { renderReportMetadataTemplate, reportExecutionMetadata } from './period-metadata.js';
import { captureReportSources } from './source/capture.js';
import { probeReportHttpSources, type ReportHttpProbe } from './source/probe.js';
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
  inferCapturePlan(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    httpConnections: ReportHttpConnectionSummary[];
    rdbTables: string[];
    connectedConnectors: string[];
  }): Promise<ReportCaptureInference>;
  refineCapturePlan?(input: {
    goal: string;
    pair: Awaited<ReturnType<DocumentEngineClient['pdfReportAnalyze']>>;
    provisional: ReportCaptureInference;
    httpProbes: ReportHttpProbe[];
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
  return parseHttpEndpoints(config).flatMap((endpoint) => {
    try {
      const url = new URL(endpoint.baseUrl);
      return [{ id: endpoint.id, label: endpoint.label?.trim() || endpoint.id, basePath: url.pathname || '/' }];
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
          connections: ctx.connections ?? [],
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
      const pair = await stage('pair_analysis', { template: params.templateSourceId, example: params.exampleSourceId }, () => this.dependencies.documentEngine.pdfReportAnalyze(
        template.artifact.storedPath,
        example.artifact.storedPath,
      ), (saved) => [...saved.templateImages, ...saved.exampleImages].every(existsSync));

      const rdb = this.dependencies.getConnector('rdb');
      phase = 'rdb_schema';
      let rdbTables: string[] = [];
      if (rdb) {
        const schema = await rdb.execute('schema.describe', {}, ctx);
        if (!schema.ok || !Array.isArray(schema.data) || !schema.data.every((value) => typeof value === 'string')) {
          throw new Error('report_rdb_schema_failed');
        }
        rdbTables = schema.data;
      }
      const httpConnections = httpConnectionSummaries(ctx);
      const connectedConnectors = ['document', ...(httpConnections.length ? ['http'] : []), ...(rdb ? ['rdb'] : [])];
      const gateway = {
        executeHttp: async (request: Record<string, unknown>) => {
          const connector = this.dependencies.getConnector('http');
          return connector
            ? connector.execute('request', request, ctx)
            : { ok: false, error: 'http connector missing', errorCode: 'connector_missing' };
        },
        executeRdb: async (request: Record<string, unknown>) => {
          const connector = this.dependencies.getConnector('rdb');
          return connector
            ? connector.execute('query.read', request, ctx)
            : { ok: false, error: 'rdb connector missing', errorCode: 'connector_missing' };
        },
      };

      phase = 'source_plan';
      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_source_plan_started', message: '보고서에 필요한 데이터 조회 방법을 구성하고 있습니다.' });
      const provisionalCapture = await stage('source_plan', { pair, httpConnections, rdbTables }, () => planner.inferCapturePlan({
        goal: params.goal,
        pair,
        httpConnections,
        rdbTables,
        connectedConnectors,
      }));
      let capture = provisionalCapture;
      if (provisionalCapture.capturePlan.http.length > 0) {
        if (!planner.refineCapturePlan) throw new Error('report_http_refiner_unavailable');
        ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_http_probe_started', message: '주문 API의 응답 구조를 읽기 전용으로 확인하고 있습니다.' });
        phase = 'http_probe';
        const httpProbes = await stage('http_probe', provisionalCapture.capturePlan, () => probeReportHttpSources(provisionalCapture.capturePlan, gateway));
        phase = 'source_refinement';
        capture = await stage('source_refinement', { provisionalCapture, httpProbes }, () => planner.refineCapturePlan!({
          goal: params.goal,
          pair,
          provisional: provisionalCapture,
          httpProbes,
          httpConnections,
          rdbTables,
          connectedConnectors,
        }));
      }

      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_example_capture_started', message: '완성 예시 기간의 연결 데이터를 검증하고 있습니다.' });
      phase = 'example_capture';
      const exampleSources = await stage('example_capture', capture, () => captureReportSources(capture.capturePlan, capture.examplePeriod, gateway));
      phase = 'business_plan';
      ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_business_plan_started', message: '예시 보고서의 계산 기준과 양식 배치를 구성하고 있습니다.' });
      let business = await stage('business_plan', { pair, capture, exampleSources }, () => planner.inferReportPlan({
        goal: params.goal,
        pair,
        capture,
        exampleSources,
        connectedConnectors,
      }));
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
      const targetResult = executeReportPlan(
        business.reportPlan,
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
