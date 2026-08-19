import { createDatabaseAsync } from './store/db.js';
import { SkillStore } from './store/skill-store.js';
import { SkillRuntime } from './runtime/engine.js';
import { Scheduler } from './runtime/scheduler.js';
import { TriggerEngine } from './runtime/trigger-engine.js';
import { buildConnectorsFromStore } from './connectors/registry.js';
import { createAgentHarness, type AgentHarness } from './agent/harness.js';
import {
  DEFAULT_AI_PROVIDER,
  normalizeAiProviderConfig,
  type AiProviderConfig,
} from './agent/settings/config.js';
import type { ExecutionResult } from './runtime/types.js';

export interface AxStudioCoreOptions {
  dbPath: string;
  cloudApiKey?: string;
  cloudBaseURL?: string;
  cloudModel?: string;
  onExecutionStarted?: (executionId: string) => void;
  onExecutionFinished?: (result: ExecutionResult) => void;
}

export interface AxStudioCore {
  db: Awaited<ReturnType<typeof createDatabaseAsync>>;
  store: SkillStore;
  runtime: SkillRuntime;
  scheduler: Scheduler;
  triggerEngine: TriggerEngine;
  /** In-app AI는 Harness를 통해서만 호출합니다. ModelProvider는 Harness 내부에만 있습니다. */
  agentHarness: AgentHarness;
  refreshAgentHarness(config: AiProviderConfig): AgentHarness;
}

export async function createAxStudioCore(options: AxStudioCoreOptions): Promise<AxStudioCore> {
  const db = await createDatabaseAsync(options.dbPath);
  const store = new SkillStore(db);

  const aiConfig = normalizeAiProviderConfig(
    store.getSetting<AiProviderConfig | unknown>('aiProvider', DEFAULT_AI_PROVIDER),
  );
  const agentHarness = createAgentHarness(aiConfig);

  const globalActive = store.getSetting<boolean>('globalActive', true);
  const skillActive: Record<string, boolean> = {};
  for (const skill of store.listSkills()) {
    skillActive[skill.id] = skill.active;
  }

  const connectors = buildConnectorsFromStore(store);
  const runtime = new SkillRuntime({
    store,
    agentHarness,
    globalActive,
    skillActive,
    connectors,
    onExecutionStarted: options.onExecutionStarted,
    onExecutionFinished: options.onExecutionFinished,
  });
  const scheduler = new Scheduler(store, runtime);
  const triggerEngine = new TriggerEngine(store, runtime);

  const core: AxStudioCore = {
    db,
    store,
    runtime,
    scheduler,
    triggerEngine,
    agentHarness,
    refreshAgentHarness(config: AiProviderConfig) {
      core.agentHarness.configure(normalizeAiProviderConfig(config));
      runtime.setAgentHarness(core.agentHarness);
      return core.agentHarness;
    },
  };

  return core;
}
