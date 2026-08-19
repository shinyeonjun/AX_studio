import { createDatabaseAsync } from './store/db.js';
import { SkillStore } from './store/skill-store.js';
import { SkillRuntime } from './runtime/engine.js';
import { Scheduler } from './runtime/scheduler.js';
import { buildConnectorsFromStore } from './connectors/registry.js';
import {
  createModelProvider,
  DEFAULT_AI_PROVIDER,
  normalizeAiProviderConfig,
  type AiProviderConfig,
} from './models/ai-config.js';

export interface AxStudioCoreOptions {
  dbPath: string;
  cloudApiKey?: string;
  cloudBaseURL?: string;
  cloudModel?: string;
}

export async function createAxStudioCore(options: AxStudioCoreOptions) {
  const db = await createDatabaseAsync(options.dbPath);
  const store = new SkillStore(db);

  const aiConfig = normalizeAiProviderConfig(
    store.getSetting<AiProviderConfig | unknown>('aiProvider', DEFAULT_AI_PROVIDER),
  );
  const model = createModelProvider(aiConfig);

  const globalActive = store.getSetting<boolean>('globalActive', true);
  const skillActive: Record<string, boolean> = {};
  for (const skill of store.listSkills()) {
    skillActive[skill.id] = skill.active;
  }

  const connectors = buildConnectorsFromStore(store);
  const runtime = new SkillRuntime({ store, model, globalActive, skillActive, connectors });
  const scheduler = new Scheduler(store, runtime);

  return { db, store, runtime, scheduler, model };
}
