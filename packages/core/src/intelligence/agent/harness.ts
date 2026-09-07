import type { AiProviderConfig } from './settings/config.js';
import { resolveAiProviderConfig } from './settings/config.js';
import { createModelProvider } from './model/factory.js';
import type { ModelProvider } from './model/provider.js';
import type { AgentResult, AgentRun } from './types.js';
import type {
  InvestigationRunRequest,
  InvestigationRunner,
} from './investigation-runner.js';
import { runAgent } from './harness/run.js';

export { isCloudProvider } from './harness/policy.js';

export class AgentHarness {
  private model: ModelProvider;
  private readonly activeRuns = new Map<Promise<unknown>, ModelProvider>();
  private readonly pendingDisposals = new Set<Promise<void>>();
  private disposed = false;

  constructor(config: AiProviderConfig);
  constructor(model: ModelProvider);
  constructor(configOrModel: AiProviderConfig | ModelProvider) {
    this.model = isModelProvider(configOrModel)
      ? configOrModel
      : createModelProvider(resolveAiProviderConfig(configOrModel));
  }

  configure(config: AiProviderConfig): void {
    if (this.disposed) throw new Error('agent_harness_disposed');
    const next = createModelProvider(resolveAiProviderConfig(config));
    this.retire(this.model);
    this.model = next;
  }

  get providerName(): string {
    return this.model.name;
  }

  get modelName(): string | undefined {
    return this.model.model;
  }

  run<T>(request: AgentRun<T>): Promise<AgentResult<T>> {
    if (this.disposed) return Promise.reject(new Error('agent_harness_disposed'));
    const run = runAgent(this.model, request);
    this.activeRuns.set(run, this.model);
    return run.finally(() => { this.activeRuns.delete(run); });
  }

  async dispose(): Promise<void> {
    if (!this.disposed) { this.disposed = true; this.retire(this.model); }
    await Promise.all(this.pendingDisposals);
  }

  private retire(model: ModelProvider): void {
    const runs = [...this.activeRuns].filter(([, owner]) => owner === model).map(([run]) => run);
    const disposal = Promise.allSettled(runs).then(() => model.dispose?.());
    this.pendingDisposals.add(disposal);
    void disposal.then(
      () => { this.pendingDisposals.delete(disposal); },
      error => { this.pendingDisposals.delete(disposal); console.error('[AX] Provider cleanup failed:', error); },
    );
  }
}

export function createInvestigationRunner(harness: AgentHarness): InvestigationRunner {
  return {
    get providerName() {
      return harness.providerName;
    },
    run<T>(request: InvestigationRunRequest<T>) {
      return harness.run({ role: 'investigate', ...request });
    },
  };
}

function isModelProvider(value: AiProviderConfig | ModelProvider): value is ModelProvider {
  return typeof value === 'object' && value !== null && 'generateStructured' in value;
}

export function createAgentHarness(config: AiProviderConfig): AgentHarness;
export function createAgentHarness(model: ModelProvider): AgentHarness;
export function createAgentHarness(configOrModel: AiProviderConfig | ModelProvider): AgentHarness {
  if (isModelProvider(configOrModel)) {
    return new AgentHarness(configOrModel);
  }
  return new AgentHarness(configOrModel);
}
