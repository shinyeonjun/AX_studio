import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConnectorContext, ConnectorResult } from '../../connectors/types.js';
import { ReportSourceRequirementsSchema, type ReportUnavailableSource } from './planner/schema.js';
import { repairReportTableCapacities } from './planner/planner.js';
import type { ReportPlanReplayFailure } from './planner/planner.js';
import { executeReportPlan } from './plan/execute.js';
import { materializeReportLayout, verifyReportExampleReplay } from './layout/materialize.js';
import { renderReportMetadataTemplate, reportExecutionMetadata } from './period-metadata.js';
import { captureReportSources } from './source/capture.js';
import { normalizeReportHttpPath } from './source/schema.js';
import { reportDigest, type ReportCheckpoint } from './checkpoints.js';
import type { ReportGenerationDependencies } from './service/contracts.js';
import { fileDigest, parseParams, reportConnectionIdentity, safeReportFileName } from './service/request.js';
import { GENERATED_FILE_TYPES } from '../../contracts/artifacts/generated-file.js';
import type { PdfReportPairAnalysis } from '../read/types/pdf.js';
import { httpConnectionSummaries, reportHttpEvidencePathnames } from './service/http-sources.js';
import { errorCode, safeErrorData } from './service/errors.js';
import { planReportSources } from './service/source-planning.js';
import { listReportFiles } from './service/file-sources.js';

export type { ReportGenerationDependencies } from './service/contracts.js';

const MAX_REPORT_PLAN_ATTEMPTS = 3;

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

      const example = this.dependencies.workspaceSources.resolveStoredFile(ctx.workspaceSessionId, params.exampleSourceId);
      // A Word report is its own form: its values are marked where they sit, so no blank is needed.
      const wordReport = example.source.fileName.toLowerCase().endsWith('.docx');
      if (!wordReport && !example.source.fileName.toLowerCase().endsWith('.pdf')) throw new Error('report_example_pdf_required');
      const template = params.templateSourceId && !wordReport
        ? this.dependencies.workspaceSources.resolveStoredFile(ctx.workspaceSessionId, params.templateSourceId)
        : undefined;
      if (template && !template.source.fileName.toLowerCase().endsWith('.pdf')) throw new Error('report_template_pdf_required');

      if (params.resumeExecutionId && !this.dependencies.checkpoints) throw new Error('report_resume_unavailable');
      if (this.dependencies.checkpoints) {
        const [templateHash, exampleHash] = await Promise.all([
          template ? fileDigest(template.artifact.storedPath) : 'derived-from-example', fileDigest(example.artifact.storedPath),
        ]);
        const identity = reportDigest({ version: 1, goal: params.goal,
          template: templateHash, example: exampleHash,
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

      let templatePath = template?.artifact.storedPath;
      let pair: PdfReportPairAnalysis | undefined;
      if (wordReport) {
        ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_template_derivation_started', message: 'Word 보고서에서 기간마다 바뀌는 값을 찾고 있습니다.' });
        outputDirectory = this.dependencies.makeTemporaryDirectory?.() ?? mkdtempSync(join(tmpdir(), 'ax-report-'));
        mkdirSync(outputDirectory, { recursive: true });
        const markedPath = join(outputDirectory, 'template.docx');
        const { docxReportSpans, docxReportPrepare } = this.dependencies.documentEngine;
        const inferExampleValues = planner.inferExampleValues?.bind(planner);
        if (!docxReportSpans || !docxReportPrepare || !inferExampleValues) throw new Error('report_word_unsupported');
        const prepared = await stage('template_derivation', { version: 1, format: 'docx', example: params.exampleSourceId }, async () => {
          const listed = await docxReportSpans.call(this.dependencies.documentEngine, example.artifact.storedPath);
          const removals = await inferExampleValues({ goal: params.goal, spans: listed, signal: ctx.abortSignal, log: ctx.log });
          return docxReportPrepare.call(this.dependencies.documentEngine, example.artifact.storedPath, removals, markedPath);
        }, (saved) => existsSync(saved.templatePath));
        templatePath = prepared.templatePath;
        pair = prepared.pair;
      } else if (!templatePath) {
        // Only last period's report: its values are told from its form, then taken out of it.
        ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_template_derivation_started', message: '완성 보고서에서 기간마다 바뀌는 값을 찾아 빈 양식을 만들고 있습니다.' });
        outputDirectory = this.dependencies.makeTemporaryDirectory?.() ?? mkdtempSync(join(tmpdir(), 'ax-report-'));
        mkdirSync(outputDirectory, { recursive: true });
        const blankPath = join(outputDirectory, 'blank-template.pdf');
        const { pdfReportSpans, pdfReportBlank } = this.dependencies.documentEngine;
        const inferExampleValues = planner.inferExampleValues?.bind(planner);
        if (!pdfReportSpans || !pdfReportBlank || !inferExampleValues) throw new Error('report_template_source_required');
        templatePath = await stage('template_derivation', { version: 1, example: params.exampleSourceId }, async () => {
          const listed = await pdfReportSpans.call(this.dependencies.documentEngine, example.artifact.storedPath);
          const removals = await inferExampleValues({ goal: params.goal, spans: listed, signal: ctx.abortSignal, log: ctx.log });
          return (await pdfReportBlank.call(this.dependencies.documentEngine, example.artifact.storedPath, removals, blankPath)).templatePath;
        }, (saved) => existsSync(saved));
      }
      if (!pair) {
        const blankPath = templatePath;
        ctx.log({ at: new Date().toISOString(), level: 'info', code: 'report_pair_analysis_started', message: '보고서 양식과 완성 예시를 비교하고 있습니다.' });
        phase = 'pair_analysis';
        pair = await stage('pair_analysis', { version: 2, template: params.templateSourceId ?? 'derived', example: params.exampleSourceId }, () => this.dependencies.documentEngine.pdfReportAnalyze(
          blankPath,
          example.artifact.storedPath,
        ), (saved) => [...saved.templateImages, ...saved.exampleImages].every(existsSync));
      }
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
      const sheetReader = this.dependencies.getConnector('local_sheet');
      const files = sheetReader ? await listReportFiles(ctx, this.dependencies.getConnector('local_folder')) : [];
      const connectedConnectors = ['document', ...(httpConnections.length ? ['http'] : []), ...(rdb ? ['rdb'] : []),
        ...(files.length ? ['file'] : [])];
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
        // Only a file in a connected folder; the reader keeps the path inside that folder.
        ...(sheetReader ? { executeFile: async (request: { folderId: string; path: string; sheet?: string }) =>
          sheetReader.execute('read', { folderId: request.folderId, path: request.path,
            ...(request.sheet ? { sheet: request.sheet } : {}) }, ctx) } : {}),
      };

      phase = 'source_requirements';
      // Names only (no rows, no file contents), so the choice can see what each source holds.
      const sourceNames = {
        http: httpConnections.map((connection) => connection.label),
        rdb: rdbTables,
        file: files.map((file) => `${file.folderLabel}/${file.path}`),
      };
      const requiredSources = await stage('source_requirements', { version: 3, goal: params.goal, pair, unavailableSources, sourceNames },
        () => planner.inferSourceRequirements({ goal: params.goal, pair, connectedConnectors, sourceNames, unavailableSources,
          signal: ctx.abortSignal, log: ctx.log }));
      const initialRequirements = ReportSourceRequirementsSchema.parse({ schemaVersion: 1, requirements: requiredSources }).requirements;
      const planned = await planReportSources({
        ctx, goal: params.goal, pair, stage, setPhase: (next) => { phase = next; },
        planner, basePlanner: this.dependencies.planner, rdb, rdbTables, unavailableSources,
        httpConnections, files, reportEvidencePathnames, assertHttpSourcePath, connectedConnectors, gateway,
        initialRequirements,
      });
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
      const targetSources = await stage('target_capture', capture, () => captureReportSources(
        capture.capturePlan, capture.targetPeriod, gateway, {}, capture.examplePeriod));
      const targetMetadata = reportExecutionMetadata(
        capture.targetPeriod,
        capture.capturePlan,
        'target',
        capture.examplePeriod,
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
      outputDirectory ??= this.dependencies.makeTemporaryDirectory?.() ?? mkdtempSync(join(tmpdir(), 'ax-report-'));
      mkdirSync(outputDirectory, { recursive: true });
      const output = wordReport ? GENERATED_FILE_TYPES.docx : GENERATED_FILE_TYPES.pdf;
      const fileName = safeReportFileName(outputFileName, output.extension);
      // A short fixed name keeps the engine's temp path well under Windows MAX_PATH;
      // the display name only travels as artifact metadata.
      const outputPath = join(outputDirectory, `report.${output.extension}`);
      let filled: { outputPath: string; verified: boolean; pageCount?: number };
      if (wordReport) {
        phase = 'docx_render';
        const { docxReportFill } = this.dependencies.documentEngine;
        if (!docxReportFill) throw new Error('report_word_unsupported');
        filled = await docxReportFill.call(this.dependencies.documentEngine, templatePath, {
          groups: pair.tableGroups.map((group) => ({ id: group.id, rows: group.rows.map((row) => row.cells.map((cell) => cell.id)) })),
          values: targetLayout.values,
          outputPath,
        });
      } else {
        phase = 'pdf_render';
        filled = await this.dependencies.documentEngine.pdfFormFill(templatePath, {
          template: targetLayout.template,
          values: targetLayout.values,
          outputPath,
        });
      }
      if (!filled.verified || !existsSync(filled.outputPath)) throw new Error(`report_${output.extension}_verification_failed`);
      phase = 'artifact_store';
      const artifact = ctx.artifactSink.putBytes(readFileSync(filled.outputPath), {
        fileName,
        mimeType: output.mimeType,
      });
      ctx.log({
        at: new Date().toISOString(), level: 'info', code: output.logCode,
        message: `보고서 ${output.label} 파일을 생성했습니다.`,
        data: {
          artifactId: artifact.id,
          fileName: artifact.fileName,
          size: artifact.size,
          mimeType: artifact.mimeType,
          ...(filled.pageCount !== undefined ? { pageCount: filled.pageCount } : {}),
          exampleReplayVerified: true,
          sourceFingerprints: Object.fromEntries(Object.entries(targetSources).map(([id, source]) => [id, source.fingerprint])),
        },
      });
      if (checkpoint) {
        checkpoint.status = 'completed';
        try { saveCheckpoint(); } catch {
          ctx.log({ at: new Date().toISOString(), level: 'warn', code: 'report_checkpoint_save_failed', message: '보고서는 생성했으나 중간 기록의 완료 상태 저장에 실패했습니다.' });
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
