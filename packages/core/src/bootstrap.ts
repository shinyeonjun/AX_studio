import { createDatabaseAsync } from './store/db.js';
import { WorkflowStore } from './store/workflow-store.js';
import { WorkflowRuntime } from './runtime/engine.js';
import { Scheduler } from './runtime/scheduler.js';
import { TriggerEngine } from './runtime/trigger-engine.js';
import { runSavedWorkflowById } from './runtime/manual-workflow-run.js';
import { buildConnectorsFromStore } from './modules/registry.js';
import { createAgentHarness, createInvestigationRunner, type AgentHarness } from './agent/harness.js';
import { AxCommandService } from './agent/commands/service.js';
import {
  DEFAULT_AI_PROVIDER,
  normalizeAiProviderConfig,
  type AiProviderConfig,
} from './agent/settings/config.js';
import type { DesktopPrintBridge } from './document-write/desktop-print.js';
import { setDesktopPrintBridge } from './document-write/desktop-print.js';
import type { ExecutionResult } from './runtime/types.js';
import type { PushTransportState } from './triggers/push-state.js';
import {
  resolveAxDataPaths,
  setAxDataPaths,
  type AxDataPaths,
} from './paths/ax-data.js';

export interface AxStudioCoreOptions {
  /** Unified data root — preferred over dbPath alone. */
  dataRoot?: string;
  /** Pre-resolved layout; wins over dataRoot. */
  paths?: AxDataPaths;
  dbPath?: string;
  cloudApiKey?: string;
  cloudBaseURL?: string;
  cloudModel?: string;
  /** Electron injects Chromium printToPDF; omit in core-only tests. */
  desktopPrintBridge?: DesktopPrintBridge | null;
  onExecutionStarted?: (executionId: string) => void;
  onExecutionProgress?: (progress: import('./runtime/types.js').ExecutionProgress) => void;
  onExecutionFinished?: (result: ExecutionResult) => void;
  onPushTransportStateChanged?: (triggerType: string, state: PushTransportState) => void;
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
  refreshAgentHarness(config: AiProviderConfig): AgentHarness;
}

export async function createAxStudioCore(options: AxStudioCoreOptions): Promise<AxStudioCore> {
  if (options.desktopPrintBridge !== undefined) {
    setDesktopPrintBridge(options.desktopPrintBridge);
  }

  const paths = options.paths ?? resolveAxDataPaths({ dataRoot: options.dataRoot });
  setAxDataPaths(paths);
  const dbPath = options.dbPath ?? paths.database;

  const db = await createDatabaseAsync(dbPath);
  const store = new WorkflowStore(db);

  const aiConfig = normalizeAiProviderConfig(
    store.getSetting<AiProviderConfig | unknown>('aiProvider', DEFAULT_AI_PROVIDER),
  );
  const agentHarness = createAgentHarness(aiConfig);
  const investigationRunner = createInvestigationRunner(agentHarness);

  const globalActive = store.getSetting<boolean>('globalActive', true);
  const workflowActive: Record<string, boolean> = {};
  for (const workflow of store.listWorkflows()) {
    workflowActive[workflow.id] = workflow.active;
  }

  const connectors = buildConnectorsFromStore(store);
  const runtime = new WorkflowRuntime({
    store,
    investigationRunner,
    globalActive,
    workflowActive,
    connectors,
    onExecutionStarted: options.onExecutionStarted,
    onExecutionProgress: options.onExecutionProgress,
    onExecutionFinished: options.onExecutionFinished,
  });
  const scheduler = new Scheduler(store, runtime);
  const triggerEngine = new TriggerEngine(store, runtime, undefined, options.onPushTransportStateChanged);
  const commandService = new AxCommandService(store, {
    runWorkflow: (workflowId) => runSavedWorkflowById({ store, runtime }, workflowId),
    enqueueOnce: (workflow) => runtime.enqueueEphemeralWorkflow(workflow, { triggerType: 'manual' }),
  });

  const core: AxStudioCore = {
    db,
    store,
    runtime,
    scheduler,
    triggerEngine,
    agentHarness,
    commandService,
    refreshAgentHarness(config: AiProviderConfig) {
      core.agentHarness.configure(normalizeAiProviderConfig(config));
      runtime.setInvestigationRunner(investigationRunner);
      return core.agentHarness;
    },
  };

  return core;
}
