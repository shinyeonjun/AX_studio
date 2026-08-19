import { writeFile } from 'node:fs/promises';
import type { AiProviderConfig } from './settings/config.js';
import { resolveAiProviderConfig } from './settings/config.js';
import { createModelProvider } from './model/factory.js';
import type { ModelProvider } from './model/provider.js';
import { buildRoleSystemPrompt } from './context-builders.js';
import { loadAgentsConstitution } from './skill-load.js';
import { getRoleDefinition } from './roles.js';
import type { AgentResult, AgentRun } from './types.js';

function composeSystemPrompt(roleSystem: string): string {
  const constitution = loadAgentsConstitution();
  return `${constitution}\n\n---\n\n${roleSystem}`;
}

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

  async run<T>(request: AgentRun<T>): Promise<AgentResult<T>> {
    const definition = getRoleDefinition(request.role);
    const logs: AgentResult<T>['logs'] = [];
    const started = Date.now();

    logs.push({ level: 'info', message: `role=${request.role} skill=${definition.skillId} provider=${this.model.name}` });

    const system = composeSystemPrompt(buildRoleSystemPrompt(request.role, request.context));
    const temperature = request.temperature ?? definition.temperature;

    let raw: unknown;
    try {
      raw = await this.model.generateStructured({
        schema: request.outputSchema,
        system,
        messages: request.messages,
        user: request.user,
        temperature,
      });
    } catch (err) {
      logs.push({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    const output = request.outputSchema.parse(raw);
    const durationMs = Date.now() - started;

    logs.push({
      level: 'info',
      message: `provider=${this.model.name} durationMs=${durationMs}`,
    });

    return {
      output,
      role: request.role,
      provider: this.model.name,
      durationMs,
      policy: definition.policy,
      logs,
    };
  }
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
