import type { AiProviderConfig } from './settings/config.js';
import { resolveAiProviderConfig } from './settings/config.js';
import { createModelProvider } from './model/factory.js';
import type { ModelProvider } from './model/provider.js';
import { buildInvestigatePrompt } from './prompt/investigate-prompt.js';
import { composeAgentSystemPrompt } from './prompt/compose.js';
import { getRoleDefinition } from './types.js';
import type { AgentContext, AgentResult, AgentRun, InvestigateAgentContext } from './types.js';
import type {
  InvestigationRunRequest,
  InvestigationRunner,
} from './investigation-runner.js';

const LOCAL_PROVIDER_NAMES = new Set(['mock', 'scripted', 'openai-compatible']);

export function isCloudProvider(providerName: string): boolean {
  if (LOCAL_PROVIDER_NAMES.has(providerName)) return false;
  if (providerName.includes('ollama')) return false;
  return true;
}

function redactUntrustedContext(context: AgentContext): AgentContext {
  if (!('untrustedData' in context)) return context;
  const ctx = context as InvestigateAgentContext;
  return { ...ctx, untrustedData: undefined, evidence: [] };
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

  get modelName(): string | undefined {
    return this.model.model;
  }

  async run<T>(request: AgentRun<T>): Promise<AgentResult<T>> {
    const definition = getRoleDefinition(request.role);
    const logs: AgentResult<T>['logs'] = [];
    const started = Date.now();
    const controller = new AbortController();
    const timeoutMs = definition.policy.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortExternal = () => controller.abort();
    request.abortSignal?.addEventListener('abort', abortExternal, { once: true });

    logs.push({
      level: 'info',
      message: `role=${request.role} agentSkill=${definition.agentSkillId} provider=${this.model.name} timeoutMs=${timeoutMs}${request.logContext ? ` phase=${request.logContext}` : ''}`,
    });

    const allowCloud = request.cloudAllowed ?? definition.policy.cloudAllowed ?? true;
    let context = request.context;
    let images = request.images;
    if (!allowCloud && isCloudProvider(this.model.name)) {
      context = redactUntrustedContext(context);
      images = undefined;
      logs.push({ level: 'info', message: 'dataPolicy: redacted untrusted data for cloud backend' });
    }

    if (images?.length && this.model.supportsVision !== true) {
      throw Object.assign(new Error(`${this.model.name} Provider는 이미지 입력을 지원하지 않습니다.`), {
        code: 'vision_unavailable',
      });
    }

    const system = composeAgentSystemPrompt(
      request.systemPrompt ?? buildInvestigatePrompt(request.role, context),
    );
    const temperature = request.temperature ?? definition.temperature;
    const promptChars = system.length + (request.messages?.reduce((sum, m) => sum + m.content.length, 0) ?? request.user?.length ?? 0);

    try {
      const raw = await this.model.generateStructured({
        schema: request.outputSchema,
        system,
        messages: request.messages,
        user: request.user,
        images,
        temperature,
        timeoutMs,
        sessionId: request.sessionId,
        abortSignal: controller.signal,
        onProgress: request.onProgress,
        logContext: request.logContext,
        codexReasoningEffort:
          request.codexReasoningEffort ??
          (request.role === 'command' ? 'medium' : undefined),
        maxTurns: definition.policy.maxTurns,
      });
      const output = request.outputSchema.parse(raw);
      const durationMs = Date.now() - started;
      logs.push({
        level: 'info',
        message: `provider=${this.model.name} durationMs=${durationMs} promptChars=${promptChars}${request.logContext ? ` phase=${request.logContext}` : ''}`,
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
        throw Object.assign(new Error(`Agent timed out after ${timeoutMs}ms`), { code: 'agent_timeout' });
      }
      logs.push({
        level: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error && !(err as Error & { code?: string }).code) {
        throw Object.assign(err, { code: 'agent_invoke_failed' });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      request.abortSignal?.removeEventListener('abort', abortExternal);
    }
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
