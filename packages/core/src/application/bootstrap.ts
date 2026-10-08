import { createDatabaseAsync } from '../persistence/db.js';
import { WorkflowStore } from '../persistence/workflow-store.js';
import { DEFAULT_APPROVAL_TTL_MS, WorkflowRuntime } from '../runtime/engine.js';
import { Scheduler } from '../runtime/scheduler.js';
import { TriggerEngine } from '../runtime/trigger-engine.js';
import { runSavedWorkflowById } from '../runtime/manual-workflow-run.js';
import { buildConnectorsFromStore } from '../connectors/registry.js';
import { DocumentConnector } from '../connectors/document/index.js';
import { registerAllModules } from '../connectors/packages/register.js';
import { createAgentHarness, createInvestigationRunner, type AgentHarness } from '../intelligence/agent/harness.js';
import { AxCommandService } from '../intelligence/agent/commands/service.js';
import type { DecisionEngine } from '../contracts/decision.js';
import type { ArtifactReference, ArtifactSink } from '../connectors/types.js';
import { ArtifactStore } from '../persistence/artifact-store.js';
import { WorkspaceSourceService } from '../persistence/workspace-source-service.js';
import { ReportCheckpointStore } from '../documents/reporting/checkpoints.js';
import { join } from 'node:path';
import {
  DEFAULT_AI_PROVIDER,
  normalizeAiProviderConfig,
  type AiProviderConfig,
} from '../intelligence/agent/settings/config.js';
import type { DesktopPrintBridge } from '../documents/write/desktop-print.js';
import { setDesktopPrintBridge } from '../documents/write/desktop-print.js';
import type { ExecutionResult } from '../runtime/types.js';
import {
  publishExecutionResultToWorkspaceChat,
  type WorkspaceChatChangedEvent,
} from '../runtime/execution-result-message.js';
import type { PushTransportState } from '../triggers/push-state.js';
import {
  resolveAxDataPaths,
  setAxDataPaths,
  type AxDataPaths,
} from '../persistence/paths/ax-data.js';

export interface AxStudioCoreOptions {
  /** Unified data root — preferred over dbPath alone. */
  dataRoot?: string;
  /** Pre-resolved layout; wins over dataRoot. */
  paths?: AxDataPaths;
  dbPath?: string;
  cloudApiKey?: string;
  cloudBaseURL?: string;
  cloudModel?: string;
  /** Optional fuzzy decision plane. Deterministic execution remains authoritative. */
  decisionEngine?: DecisionEngine;
  /** Optional report planner injected by deterministic host tests. */
  reportPlanner?: import('../documents/reporting/service.js').ReportGenerationDependencies['planner'];
  /** Electron injects Chromium printToPDF; omit in core-only tests. */
  desktopPrintBridge?: DesktopPrintBridge | null;
  onExecutionStarted?: (executionId: string) => void;
  onExecutionProgress?: (progress: import('../runtime/types.js').ExecutionProgress) => void;
  onExecutionFinished?: (result: ExecutionResult) => void;
  onWorkspaceChatChanged?: (event: WorkspaceChatChangedEvent) => void;
  onPushTransportStateChanged?: (triggerType: string, state: PushTransportState) => void;
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  /**
   * Pending-approval lifetime. Defaults to DEFAULT_APPROVAL_TTL_MS (72h); tests with
   * fixed historical fixtures may pass a longer TTL. Expiry cannot be disabled here.
   */
  approvalTtlMs?: number;
}

export interface AxStudioCore {
  db: Awaited<ReturnType<typeof createDatabaseAsync>>;
  store: WorkflowStore;
  runtime: WorkflowRuntime;
  scheduler: Scheduler;
  triggerEngine: TriggerEngine;
  /** In-app AI는 Harness를 통해서만 호출합니다. ModelProvider는 Harness 내부에만 있습니다. */
  agentHarness: AgentHarness;
  /** Single AI-facing workflow/resource command boundary for every host. */
  commandService: AxCommandService;
  /** Current semantic decision provider used by chat and discovery paths. */
  readonly decisionEngine?: DecisionEngine;
  /** Session-owned files and document-engine results. */
  workspaceSources: WorkspaceSourceService;
  refreshAgentHarness(config: AiProviderConfig): AgentHarness;
  refreshDecisionEngine(decisionEngine?: DecisionEngine): void;
}

export async function createAxStudioCore(options: AxStudioCoreOptions): Promise<AxStudioCore> {
  if (options.desktopPrintBridge !== undefined) {
    setDesktopPrintBridge(options.desktopPrintBridge);
  }

  const paths = options.paths ?? resolveAxDataPaths({ dataRoot: options.dataRoot });
  setAxDataPaths(paths);
  const modulePackages = registerAllModules();
  const discoverySourceProviders = modulePackages.flatMap((pkg) =>
    pkg.discoverySource ? [pkg.discoverySource] : [],
  );
  const discoveryWorkbookMaterializer = modulePackages.find((pkg) => pkg.id === 'local_sheet')?.materializeWorkbook;
  if (!discoveryWorkbookMaterializer) {
    throw new Error('local_sheet module must register materializeWorkbook');
  }
  const dbPath = options.dbPath ?? paths.database;

  const db = await createDatabaseAsync(dbPath);
  const store = new WorkflowStore(db);
  // Bounded history retention; hosts repeat it periodically. Never fatal.
  try { store.pruneHistory(); }
  catch (error) { console.warn('[AX Studio] history retention failed', { code: (error as { code?: unknown } | null)?.code }); }
  const artifactStore = new ArtifactStore(paths.artifacts);
  const generatedArtifactStore = new ArtifactStore(paths.generated.reports);
  const generatedArtifactSink: ArtifactSink = {
    putBytes(data, options): ArtifactReference {
      const stored = generatedArtifactStore.putBytes(data, options);
      return {
        id: stored.id,
        sha256: stored.sha256,
        fileName: stored.fileName,
        ...(stored.mimeType ? { mimeType: stored.mimeType } : {}),
        size: stored.size,
        createdAt: stored.createdAt,
      };
    },
  };
  const workspaceSources = new WorkspaceSourceService(store, artifactStore, paths.sessions);

  const aiConfig = normalizeAiProviderConfig(
    store.getSetting<AiProviderConfig | unknown>('aiProvider', DEFAULT_AI_PROVIDER),
  );
  const agentHarness = createAgentHarness(aiConfig);
  const investigationRunner = createInvestigationRunner(agentHarness);

  const globalActive = store.getGlobalActive();

  const connectors = buildConnectorsFromStore(store);
  let runtime: WorkflowRuntime | undefined;
  let activeDecisionEngine = options.decisionEngine;
  let reportPlanner: import('../documents/reporting/planner/planner.js').ReportPlanner | undefined;
  let reportGenerationPromise: Promise<import('../documents/reporting/service.js').ReportGenerationService> | undefined;
  const getReportGeneration = () => {
    reportGenerationPromise ??= Promise.all([
      import('../documents/read/engine-client.js'),
      import('../documents/reporting/planner/planner.js'),
      import('../documents/reporting/service.js'),
    ]).then(([{ getDocumentEngineClient }, { ReportPlanner }, { ReportGenerationService }]) => {
      const planner = options.reportPlanner ?? new ReportPlanner(investigationRunner, { decisionEngine: activeDecisionEngine });
      reportPlanner = planner instanceof ReportPlanner ? planner : undefined;
      return new ReportGenerationService({
        checkpoints: new ReportCheckpointStore(join(paths.sessions, 'report-checkpoints')),
        workspaceSources,
        documentEngine: getDocumentEngineClient(),
        planner,
        getConnector: (name) => runtime?.connectors[name] ?? connectors[name],
      });
    }).catch((error: unknown) => {
      reportGenerationPromise = undefined;
      throw error;
    });
    return reportGenerationPromise;
  };
  connectors.document = new DocumentConnector({
    'pdf.report.generate': async (params, ctx) => (await getReportGeneration()).generate(params, ctx),
  });
  runtime = new WorkflowRuntime({
    store,
    investigationRunner,
    decisionEngine: options.decisionEngine,
    globalActive,
    connectors,
    artifactSink: generatedArtifactSink,
    approvalTtlMs: resolveApprovalTtlMs(options.approvalTtlMs),
    onEphemeralJobFailed: (jobId, error) => {
      console.error('[AX Studio] ephemeral workflow job failed before an execution record was written', {
        jobId,
        code: (error as { code?: unknown } | null)?.code,
        message: error instanceof Error ? error.message : String(error),
      });
    },
    onExecutionStarted: options.onExecutionStarted,
    onExecutionProgress: options.onExecutionProgress,
    onExecutionFinished: (result) => {
      let refreshFailed = false;
      try {
        const event = publishExecutionResultToWorkspaceChat(store, result);
        if (event) {
          try {
            options.onWorkspaceChatChanged?.(event);
          } catch {
            refreshFailed = true;
          }
        }
      } catch {
        refreshFailed = true;
      }
      try {
        options.onExecutionFinished?.(result);
      } catch {
        refreshFailed = true;
      }
      if (refreshFailed) {
        // Notify the other observer first; runtime preserves the outcome and
        // records the presentation failure separately from the provider receipt.
        throw new Error('Execution completion presentation refresh failed.');
      }
    },
  });
  const scheduler = new Scheduler(store, runtime);
  const triggerEngine = new TriggerEngine(store, runtime, undefined, options.onPushTransportStateChanged);
  const commandService = new AxCommandService(store, {
    removeWorkflow: (workflowId) => runtime.removeWorkflow(workflowId),
    runWorkflow: (workflowId) => runSavedWorkflowById({ store, runtime }, workflowId),
    enqueueOnce: (workflow, enqueueOptions) => runtime.enqueueEphemeralWorkflow(workflow, {
      triggerType: 'manual',
      workspaceSessionId: enqueueOptions?.workspaceSessionId,
    }),
    artifactStore,
    workspaceSources,
    resolveConnectionConfig: options.resolveConnectionConfig,
    discoverySourceProviders,
    discoveryWorkbookMaterializer,
    decisionEngine: activeDecisionEngine,
    autoResumeDiscovery: true,
  });

  const core: AxStudioCore = {
    db,
    store,
    runtime,
    scheduler,
    triggerEngine,
    agentHarness,
    commandService,
    get decisionEngine() {
      return activeDecisionEngine;
    },
    workspaceSources,
    refreshAgentHarness(config: AiProviderConfig) {
      core.agentHarness.configure(normalizeAiProviderConfig(config));
      runtime.setInvestigationRunner(investigationRunner);
      return core.agentHarness;
    },
    refreshDecisionEngine(decisionEngine?: DecisionEngine) {
      activeDecisionEngine = decisionEngine;
      commandService.setDecisionEngine(decisionEngine);
      reportPlanner?.setDecisionEngine(decisionEngine);
      runtime.setDecisionEngine(decisionEngine);
    },
  };

  return core;
}

function resolveApprovalTtlMs(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_APPROVAL_TTL_MS;
}
