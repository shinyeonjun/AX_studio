import { z } from 'zod';
import type { AgentHarness } from '../agent/harness.js';
import { buildRoleSystemPrompt } from '../agent/context-builders.js';
import { loadAgentsConstitution } from '../agent/skill-load.js';
import { parseToolCallsJsonPayload, usesCliWireEnvelope } from '../platform/provider-envelope.js';
import type { DesignToolContext } from '../design-tools/index.js';
import { runStructuredDesignToolLoop } from '../design-tools/agent-loop.js';
import { DesignToolCallSchema, MAX_DESIGN_TOOL_CALLS_PER_TURN } from '../design-tools/types.js';
import type { WorkspaceAgentContext } from '../agent/types.js';
import {
  buildConnectedResourcesFromConnections,
  formatConnectedResourcesForPrompt,
} from '../interview/resources/connected-resources.js';
import { runAnthropicNativeWorkspaceChat } from './anthropic-native.js';
import { runOpenAiNativeWorkspaceChat } from './openai-native.js';

const XAI_BASE_URL = process.env.XAI_BASE_URL?.trim() || 'https://api.x.ai/v1';

export const WORKSPACE_CHAT_MAX_ROUNDS = 5;

export const WorkspaceChatOutputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tools'),
    toolCalls: z.array(DesignToolCallSchema).min(1).max(MAX_DESIGN_TOOL_CALLS_PER_TURN),
  }),
  z.object({
    kind: z.literal('reply'),
    message: z.string().min(1),
  }),
]);

export type WorkspaceChatOutput = z.infer<typeof WorkspaceChatOutputSchema>;

/** CLI structured-output wire envelope: nested tool calls encoded as a JSON string. */
export const WorkspaceChatWireEnvelopeSchema = z.object({
  kind: z.enum(['tools', 'reply']),
  message: z.string().default(''),
  toolCalls: z.string().default(''),
});

export type WorkspaceChatWireEnvelope = z.infer<typeof WorkspaceChatWireEnvelopeSchema>;

export function workspaceChatOutputSchemaForProvider(providerName: string): z.ZodType {
  return usesCliWireEnvelope(providerName)
    ? WorkspaceChatWireEnvelopeSchema
    : WorkspaceChatOutputSchema;
}

function parseWorkspaceToolCallsPayload(raw: unknown): z.infer<typeof DesignToolCallSchema>[] | undefined {
  return parseToolCallsJsonPayload(raw, DesignToolCallSchema);
}

export function expandWorkspaceChatWireEnvelope(envelope: WorkspaceChatWireEnvelope): WorkspaceChatOutput {
  if (envelope.kind === 'reply') {
    const message = envelope.message.trim();
    if (!message) throw new Error('workspace_chat_empty_reply');
    return { kind: 'reply', message };
  }

  const toolCalls = parseWorkspaceToolCallsPayload(envelope.toolCalls);
  if (!toolCalls?.length) throw new Error('workspace_chat_empty_tool_calls');
  return { kind: 'tools', toolCalls };
}

function isNativeWorkspaceOutput(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.kind === 'tools' && Array.isArray(record.toolCalls)) return true;
  return record.kind === 'reply' && typeof record.message === 'string';
}

export function normalizeWorkspaceChatOutput(providerName: string, value: unknown): WorkspaceChatOutput {
  if (isNativeWorkspaceOutput(value)) {
    return WorkspaceChatOutputSchema.parse(value);
  }
  if (usesCliWireEnvelope(providerName)) {
    const envelope = WorkspaceChatWireEnvelopeSchema.parse(value);
    return expandWorkspaceChatWireEnvelope(envelope);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message.trim()) {
      return { kind: 'reply', message: record.message.trim() };
    }
  }
  if (typeof value === 'string' && value.trim()) {
    return { kind: 'reply', message: value.trim() };
  }
  throw new Error(`workspace_chat_invalid_output:${providerName}`);
}

export interface WorkspaceChatOptions {
  harness: AgentHarness;
  designToolContext: DesignToolContext;
  connectedConnectors?: string[];
  messages: import('../agent/model/chat.js').ChatMessage[];
  userMessage: string;
  /** Optional provider-owned resume id. This is never the workspace DB chat id. */
  providerSessionId?: string;
  onProgress?: (event: { message: string }) => void;
}

function workspaceContext(options: WorkspaceChatOptions): WorkspaceAgentContext {
  const connectedConnectors = options.connectedConnectors ?? [];
  const resources = buildConnectedResourcesFromConnections(options.designToolContext.connections);
  return {
    connectedConnectors,
    connectedResources: formatConnectedResourcesForPrompt(resources),
    nowIso: new Date().toISOString(),
  };
}

function workspaceSystemPrompt(options: WorkspaceChatOptions): string {
  const constitution = loadAgentsConstitution();
  const roleSystem = buildRoleSystemPrompt('workspace', workspaceContext(options));
  return `${constitution}\n\n---\n\n${roleSystem}`;
}

function parseWorkspaceOutput(providerName: string, value: unknown): WorkspaceChatOutput {
  return normalizeWorkspaceChatOutput(providerName, value);
}

async function runStructuredWorkspaceChat(options: WorkspaceChatOptions): Promise<string> {
  const providerName = options.harness.providerName;
  const outputSchema = workspaceChatOutputSchemaForProvider(providerName);
  let round = 0;
  return runStructuredDesignToolLoop({
    maxRounds: WORKSPACE_CHAT_MAX_ROUNDS,
    messages: options.messages,
    userMessage: options.userMessage,
    designToolContext: options.designToolContext,
    onProgress: options.onProgress,
    exhaustedMessage:
      '연결된 리소스를 확인했지만 답변을 마무리하지 못했습니다. 질문을 조금 더 구체적으로 해 주세요.',
    runModel: async (messages) => {
      const phase = round === 0 ? 'workspace_chat' : `workspace_chat_${round}`;
      round += 1;
      const { output } = await options.harness.run({
        role: 'workspace',
        outputSchema,
        context: workspaceContext(options),
        messages,
        sessionId: options.providerSessionId,
        onProgress: options.onProgress,
        logContext: phase,
      });
      return output;
    },
    parseOutput: (output) => {
      const parsed = parseWorkspaceOutput(providerName, output);
      if (parsed.kind === 'reply') return parsed;
      return { kind: 'tools', toolCalls: parsed.toolCalls };
    },
  });
}

/** Read-only chat over connected resources. Uses native tool APIs when available. */
export async function runWorkspaceChat(options: WorkspaceChatOptions): Promise<string> {
  const system = workspaceSystemPrompt(options);
  const model = options.harness.modelName;

  if (options.harness.providerName === 'anthropic-api') {
    if (!model) throw new Error('Anthropic API 모델이 설정되지 않았습니다.');
    return runAnthropicNativeWorkspaceChat({
      model,
      system,
      messages: options.messages,
      userMessage: options.userMessage,
      designToolContext: options.designToolContext,
      onProgress: options.onProgress,
    });
  }

  if (options.harness.providerName === 'openai-api') {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
    if (!model) throw new Error('OpenAI API 모델이 설정되지 않았습니다.');
    return runOpenAiNativeWorkspaceChat({
      baseURL: 'https://api.openai.com/v1',
      apiKey,
      model,
      system,
      messages: options.messages,
      userMessage: options.userMessage,
      designToolContext: options.designToolContext,
      onProgress: options.onProgress,
    });
  }

  if (options.harness.providerName === 'grok-api') {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) throw new Error('XAI_API_KEY가 설정되지 않았습니다.');
    if (!model) throw new Error('Grok API 모델이 설정되지 않았습니다.');
    return runOpenAiNativeWorkspaceChat({
      baseURL: XAI_BASE_URL,
      apiKey,
      model,
      system,
      messages: options.messages,
      userMessage: options.userMessage,
      designToolContext: options.designToolContext,
      onProgress: options.onProgress,
    });
  }

  return runStructuredWorkspaceChat(options);
}
