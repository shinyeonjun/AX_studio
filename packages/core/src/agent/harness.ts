import type { AiProviderConfig } from './settings/config.js';
import { resolveAiProviderConfig } from './settings/config.js';
import { createModelProvider } from './model/factory.js';
import type { ModelProvider } from './model/provider.js';
import { buildRoleSystemPrompt } from './context-builders.js';
import { loadAgentsConstitution } from './skill-load.js';
import { getRoleDefinition } from './roles.js';
import { isCloudProvider } from './cloud.js';
import type { AgentContext, AgentResult, AgentRun, InvestigateAgentContext } from './types.js';

function composeSystemPrompt(roleSystem: string): string {
  const constitution = loadAgentsConstitution();
  return `${constitution}\n\n---\n\n${roleSystem}`;
}

function redactUntrustedContext(context: AgentContext): AgentContext {
  if (!('untrustedData' in context)) return context;
  const ctx = context as InvestigateAgentContext;
  if (!ctx.untrustedData) return context;
  return { ...ctx, untrustedData: undefined };
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
    const controller = new AbortController();
    const timeoutMs = definition.policy.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    logs.push({
      level: 'info',
      message: `role=${request.role} agentSkill=${definition.agentSkillId} provider=${this.model.name} timeoutMs=${timeoutMs}`,
    });

    const allowCloud = request.cloudAllowed ?? definition.policy.cloudAllowed ?? true;
    let context = request.context;
    if (!allowCloud && isCloudProvider(this.model.name)) {
      context = redactUntrustedContext(context);
      logs.push({ level: 'info', message: 'dataPolicy: redacted untrusted data for cloud backend' });
    }

    const system = composeSystemPrompt(buildRoleSystemPrompt(request.role, context));
    const temperature = request.temperature ?? definition.temperature;
    const promptChars = system.length + (request.messages?.reduce((sum, m) => sum + m.content.length, 0) ?? request.user?.length ?? 0);

    try {
      const raw = await this.model.generateStructured({
        schema: request.outputSchema,
        system,
        messages: request.messages,
        user: request.user,
        temperature,
        timeoutMs,
        sessionId: request.sessionId,
        abortSignal: controller.signal,
        onProgress: request.onProgress,
      });
      const output = request.outputSchema.parse(raw);
      const durationMs = Date.now() - started;
      logs.push({
        level: 'info',
        message: `provider=${this.model.name} durationMs=${durationMs} promptChars=${promptChars}`,
      });
      return {
        output,
        role: request.role,
        provider: this.model.name,
        durationMs,
        promptChars,
        policy: definition.policy,
        logs,
      };
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Agent timed out after ${timeoutMs}ms`);
      }
      logs.push({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      clearTimeout(timer);
    }
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
