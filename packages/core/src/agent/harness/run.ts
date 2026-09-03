import { appendAppLog } from '../../paths/app-log.js';
import type { ModelProvider } from '../model/provider.js';
import { buildInvestigatePrompt, composeAgentSystemPrompt } from '../prompt/index.js';
import { getRoleDefinition } from '../types.js';
import type {
  AgentContext,
  AgentResult,
  AgentRun,
  InvestigateAgentContext,
} from '../types.js';
import { isCloudProvider, redactUntrustedContext } from './policy.js';

export async function runAgent<T>(model: ModelProvider, request: AgentRun<T>): Promise<AgentResult<T>> {
  const definition = getRoleDefinition(request.role);
  const logs: AgentResult<T>['logs'] = [];
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = definition.policy.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortExternal = () => controller.abort();
  if (request.abortSignal?.aborted) {
    abortExternal();
  } else {
    request.abortSignal?.addEventListener('abort', abortExternal, { once: true });
  }

  logs.push({
    level: 'info',
    message: `role=${request.role} agentSkill=${definition.agentSkillId} provider=${model.name} timeoutMs=${timeoutMs}${request.logContext ? ` phase=${request.logContext}` : ''}`,
  });

  const allowCloud = request.cloudAllowed ?? definition.policy.cloudAllowed ?? true;
  let context = request.context;
  let images = request.images;
  if (!allowCloud && isCloudProvider(model.name)) {
    context = redactUntrustedContext(context);
    images = undefined;
    logs.push({ level: 'info', message: 'dataPolicy: redacted untrusted data for cloud backend' });
  }

  try {
    if (images?.length && model.supportsVision !== true) {
      throw Object.assign(new Error(`${model.name} Provider는 이미지 입력을 지원하지 않습니다.`), {
        code: 'vision_unavailable',
      });
    }

    const system = composeAgentSystemPrompt(
      request.systemPrompt ?? buildInvestigatePrompt(request.role, context),
    );
    const temperature = request.temperature ?? definition.temperature;
    const promptChars = system.length + (request.messages?.reduce((sum, m) => sum + m.content.length, 0) ?? request.user?.length ?? 0);

    if (request.abortSignal?.aborted) {
      throw Object.assign(new Error('Agent request aborted'), { code: 'agent_aborted' });
    }
    const raw = await model.generateStructured({
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
      message: `provider=${model.name} durationMs=${durationMs} promptChars=${promptChars}${request.logContext ? ` phase=${request.logContext}` : ''}`,
    });
    return {
      output,
      role: request.role,
      provider: model.name,
      durationMs,
      promptChars,
      policy: definition.policy,
      logs,
    };
  } catch (err) {
    if (request.abortSignal?.aborted) {
      throw Object.assign(new Error('Agent request aborted'), { code: 'agent_aborted' });
    }
    if (controller.signal.aborted) {
      const timeoutError = Object.assign(new Error(`Agent timed out after ${timeoutMs}ms`), { code: 'agent_timeout' });
      appendAppLog('error', timeoutError.message, {
        code: 'agent_timeout',
        role: request.role,
        phase: request.logContext,
      });
      throw timeoutError;
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
