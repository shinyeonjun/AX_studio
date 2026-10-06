import type { ModelProvider } from '../model/provider.js';
import { buildInvestigatePrompt } from '../prompt/index.js';
import { getRoleDefinition } from '../types.js';
import type { AgentContext, AgentResult, AgentRun } from '../types.js';
import { invokeAgent } from './invoke.js';

export async function runAgent<T>(model: ModelProvider, request: AgentRun<T>): Promise<AgentResult<T>> {
  const definition = getRoleDefinition(request.role);
  return invokeAgent(model, request, {
    label: 'Agent',
    cloudAllowedByDefault: definition.policy.cloudAllowed ?? true,
    rolePrompt: context => request.systemPrompt ?? buildInvestigatePrompt(request.role, context as AgentContext),
    call: (provider, call) => provider.generateStructured({
      ...call,
      schema: request.outputSchema,
      messages: request.messages,
      user: request.user,
      sessionId: request.sessionId,
      onProgress: request.onProgress,
      logContext: request.logContext,
      codexReasoningEffort: request.codexReasoningEffort ?? (request.role === 'command' ? 'medium' : undefined),
      maxTurns: definition.policy.maxTurns,
    }),
    finalize: raw => request.outputSchema.parse(raw),
  });
}
