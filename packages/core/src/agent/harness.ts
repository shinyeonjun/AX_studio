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

  constructor(config: AiProviderConfig);
  constructor(model: ModelProvider);
  constructor(configOrModel: AiProviderConfig | ModelProvider) {
    this.model = isModelProvider(configOrModel)
      ? configOrModel
      : createModelProvider(resolveAiProviderConfig(configOrModel));
  }

  configure(config: AiProviderConfig): void {
    this.model = createModelProvider(resolveAiProviderConfig(config));
  }

  get providerName(): string {
    return this.model.name;
  }

  get modelName(): string | undefined {
    return this.model.model;
  }

  run<T>(request: AgentRun<T>): Promise<AgentResult<T>> {
    return runAgent(this.model, request);
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
