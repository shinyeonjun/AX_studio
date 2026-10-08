import type { ModelProvider } from '../model/provider.js';
import { buildInvestigatePrompt } from '../prompt/index.js';
import type { AgentContext, AgentTextResult, AgentTextRun } from '../types.js';
import { invokeAgent } from './invoke.js';

const PLAIN_TEXT_PROMPT =
  'Return a concise plain-text response. Do not emit JSON, commands, tool calls, or internal protocol details.';

export async function runTextAgent(model: ModelProvider, request: AgentTextRun): Promise<AgentTextResult> {
  return invokeAgent(model, request, {
    label: 'Agent text',
    cloudAllowedByDefault: true,
    rolePrompt: context => request.systemPrompt ?? (
      request.role === 'investigate'
        ? buildInvestigatePrompt(request.role, (context ?? request.context) as AgentContext)
        : PLAIN_TEXT_PROMPT
    ),
    call: (provider, call) => provider.generateText({
      ...call,
      messages: request.messages,
      user: request.user,
      maxOutputTokens: 768,
      sessionId: request.sessionId,
      onProgress: request.onProgress,
      codexReasoningEffort: request.codexReasoningEffort ?? (request.role === 'command' ? 'medium' : undefined),
      maxTurns: 1,
    }),
    finalize: raw => String(raw ?? '').trim(),
  });
}
