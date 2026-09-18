import { appendAppLog } from '../../../persistence/paths/app-log.js';
import type { ModelProvider } from '../model/provider.js';
import { buildInvestigatePrompt, composeAgentSystemPrompt } from '../prompt/index.js';
import { getRoleDefinition } from '../types.js';
import type { AgentTextResult, AgentTextRun } from '../types.js';
import { isCloudProvider, redactUntrustedContext } from './policy.js';

export async function runTextAgent(
  model: ModelProvider,
  request: AgentTextRun,
): Promise<AgentTextResult> {
  const definition = getRoleDefinition(request.role);
  const logs: AgentTextResult['logs'] = [];
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), definition.policy.timeoutMs);
  const abortExternal = () => controller.abort();
  if (request.abortSignal?.aborted) {
    abortExternal();
  } else {
    request.abortSignal?.addEventListener('abort', abortExternal, { once: true });
  }

  logs.push({
    level: 'info',
    message: `role=${request.role} agentSkill=${definition.agentSkillId} provider=${model.name} timeoutMs=${definition.policy.timeoutMs}${request.logContext ? ` phase=${request.logContext}` : ''}`,
  });

  const allowCloud = request.cloudAllowed ?? true;
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

    const rolePrompt = request.systemPrompt ?? (
      request.role === 'investigate'
        ? buildInvestigatePrompt(request.role, context)
        : 'Return a concise plain-text response. Do not emit JSON, commands, tool calls, or internal protocol details.'
    );
    const system = composeAgentSystemPrompt(rolePrompt);
    const temperature = request.temperature ?? definition.temperature;
    const promptChars = system.length + (request.messages?.reduce((sum, message) => sum + message.content.length, 0) ?? request.user?.length ?? 0);
    const measurements = {
      role: request.role,
      phase: request.logContext,
      provider: model.name,
      promptChars,
      imageCount: images?.length ?? 0,
      imageBytes: images?.reduce((sum, image) => sum + image.data.byteLength, 0) ?? 0,
      timeoutMs: definition.policy.timeoutMs,
    };
    appendAppLog('info', 'Agent text invocation started', measurements);

    if (request.abortSignal?.aborted) {
      throw Object.assign(new Error('Agent request aborted'), { code: 'agent_aborted' });
    }
    const raw = await model.generateText({
      system,
      messages: request.messages,
      user: request.user,
      images,
      temperature,
      maxOutputTokens: 768,
      timeoutMs: definition.policy.timeoutMs,
      sessionId: request.sessionId,
      abortSignal: controller.signal,
      onProgress: request.onProgress,
      maxTurns: 1,
    });
    if (controller.signal.aborted) throw new Error('agent_result_after_abort');
    const output = String(raw ?? '').trim();
    const durationMs = Date.now() - started;
    appendAppLog('info', 'Agent text invocation completed', { ...measurements, durationMs });
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
  } catch (error) {
    if (request.abortSignal?.aborted) {
      throw Object.assign(new Error('Agent request aborted'), { code: 'agent_aborted' });
    }
    if (controller.signal.aborted) {
      const timeoutError = Object.assign(
        new Error(`Agent timed out after ${definition.policy.timeoutMs}ms`),
        { code: 'agent_timeout', phase: request.logContext },
      );
      appendAppLog('error', timeoutError.message, {
        code: 'agent_timeout',
        role: request.role,
        phase: request.logContext,
      });
      throw timeoutError;
    }
    logs.push({ level: 'error', message: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && !(error as Error & { code?: string }).code) {
      throw Object.assign(error, { code: 'agent_invoke_failed' });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    request.abortSignal?.removeEventListener('abort', abortExternal);
  }
}
