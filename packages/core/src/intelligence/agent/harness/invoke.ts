import { aiProviderFailureCode } from '../../../contracts/error-messages.js';
import { appendAppLog } from '../../../persistence/paths/app-log.js';
import type { ChatMessage } from '../model/chat.js';
import type { AgentProgressEvent, ModelImageInput, ModelProvider, ModelTokenUsage } from '../model/provider.js';
import { composeAgentSystemPrompt } from '../prompt/index.js';
import { getRoleDefinition } from '../types.js';
import type { AgentContext, AgentResult, AgentRole } from '../types.js';
import { isCloudProvider, redactUntrustedContext } from './policy.js';

export interface InvocationRequest {
  role: AgentRole;
  requestId?: string;
  context?: AgentContext;
  messages?: ChatMessage[];
  user?: string;
  images?: ModelImageInput[];
  temperature?: number;
  cloudAllowed?: boolean;
  onProgress?: (event: AgentProgressEvent) => void;
  logContext?: string;
  abortSignal?: AbortSignal;
}

interface ModelCall {
  system: string;
  images?: ModelImageInput[];
  temperature: number;
  timeoutMs: number;
  abortSignal: AbortSignal;
  onUsage: (usage: ModelTokenUsage) => void;
}

export interface InvocationSpec<T> {
  /** Log prefix: `Agent` or `Agent text`. */
  label: string;
  cloudAllowedByDefault: boolean;
  rolePrompt(context: AgentContext | undefined): string;
  call(model: ModelProvider, params: ModelCall): Promise<unknown>;
  finalize(raw: unknown): T;
}

/** Shared lifecycle for structured and text agent runs: policy, timeout, cancellation, telemetry. */
export async function invokeAgent<T>(
  model: ModelProvider,
  request: InvocationRequest,
  spec: InvocationSpec<T>,
): Promise<AgentResult<T>> {
  const definition = getRoleDefinition(request.role);
  const logs: AgentResult<T>['logs'] = [];
  const started = Date.now();
  const controller = new AbortController();
  const timeoutMs = definition.policy.timeoutMs;
  let usage: ModelTokenUsage | undefined;
  let measurements: Record<string, unknown> = {
    role: request.role, requestId: request.requestId, phase: request.logContext, provider: model.name, timeoutMs,
  };
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortExternal = () => controller.abort();
  if (request.abortSignal?.aborted) {
    abortExternal();
  } else {
    request.abortSignal?.addEventListener('abort', abortExternal, { once: true });
  }
  const phase = request.logContext ? ` phase=${request.logContext}` : '';

  logs.push({
    level: 'info',
    message: `role=${request.role} agentSkill=${definition.agentSkillId} provider=${model.name} timeoutMs=${timeoutMs}${phase}`,
  });

  const allowCloud = request.cloudAllowed ?? spec.cloudAllowedByDefault;
  let context = request.context;
  let images = request.images;
  if (!allowCloud && isCloudProvider(model.name) && context) {
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

    const system = composeAgentSystemPrompt(spec.rolePrompt(context));
    const promptChars = system.length + (request.messages?.reduce((sum, message) => sum + message.content.length, 0) ?? request.user?.length ?? 0);
    measurements = {
      ...measurements,
      promptChars,
      imageCount: images?.length ?? 0,
      imageBytes: images?.reduce((sum, image) => sum + image.data.byteLength, 0) ?? 0,
    };
    appendAppLog('info', `${spec.label} invocation started`, measurements);

    if (request.abortSignal?.aborted) {
      throw Object.assign(new Error('Agent request aborted'), { code: 'agent_aborted' });
    }
    const raw = await spec.call(model, {
      system,
      images,
      temperature: request.temperature ?? definition.temperature,
      timeoutMs,
      abortSignal: controller.signal,
      onUsage: reported => { usage = reported; },
    });
    // Providers may ignore cancellation. Never publish their late output as success.
    if (controller.signal.aborted) throw new Error('agent_result_after_abort');
    const output = spec.finalize(raw);
    const durationMs = Date.now() - started;
    appendAppLog('info', `${spec.label} invocation completed`, {
      ...measurements, durationMs, providerUsageAvailable: Boolean(usage), ...(usage ? { usage } : {}),
    });
    logs.push({
      level: 'info',
      message: `provider=${model.name} durationMs=${durationMs} promptChars=${promptChars}${phase}`,
    });
    return {
      output,
      role: request.role,
      provider: model.name,
      durationMs,
      promptChars,
      ...(usage ? { usage } : {}),
      policy: definition.policy,
      logs,
    };
  } catch (error) {
    const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined;
    const failureTelemetry = {
      ...measurements,
      durationMs: Date.now() - started,
      providerUsageAvailable: Boolean(usage),
      ...(usage ? { usage } : {}),
    };
    if (request.abortSignal?.aborted) {
      appendAppLog('info', `${spec.label} invocation cancelled`, failureTelemetry);
      throw Object.assign(new Error('Agent request aborted'), { code: 'agent_aborted' });
    }
    if (controller.signal.aborted) {
      const timeoutError = Object.assign(new Error(`Agent timed out after ${timeoutMs}ms`), { code: 'agent_timeout', phase: request.logContext });
      appendAppLog('error', timeoutError.message, {
        ...failureTelemetry,
        code: 'agent_timeout',
        role: request.role,
        phase: request.logContext,
      });
      throw timeoutError;
    }
    appendAppLog('error', `${spec.label} invocation failed`, {
      ...failureTelemetry,
      errorName: error instanceof Error ? error.name : 'unknown',
      ...(errorCode ? { errorCode } : {}),
    });
    logs.push({ level: 'error', message: error instanceof Error ? error.message : String(error) });
    // A sign-in, busy, missing or unreachable AI gets its own code, so the run says what to do.
    const providerFailure = aiProviderFailureCode(error);
    if (error instanceof Error && (providerFailure || !(error as Error & { code?: string }).code)) {
      throw Object.assign(error, { code: providerFailure ?? 'agent_invoke_failed' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    request.abortSignal?.removeEventListener('abort', abortExternal);
  }
}
