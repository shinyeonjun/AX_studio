import type { ChatMessage } from '../agent/model/chat.js';
import type { AgentProgressEvent } from '../agent/progress.js';
import {
  executeDesignTool,
  type DesignToolContext,
} from '../design-tools/index.js';
import { designToolIdFromNativeName, designToolNativeName, listNativeToolDescriptions } from '../design-tools/native-tools.js';
import { bootstrapDesignToolMessages, hasDesignToolResults } from '../design-tools/bootstrap.js';
import { MAX_DESIGN_TOOL_CALLS_PER_TURN } from '../design-tools/types.js';

const NATIVE_TOOL_MAX_ROUNDS = 5;

export interface AnthropicNativeChatOptions {
  model: string;
  system: string;
  messages: ChatMessage[];
  userMessage: string;
  designToolContext: DesignToolContext;
  temperature?: number;
  abortSignal?: AbortSignal;
  onProgress?: (event: AgentProgressEvent) => void;
}

interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; additionalProperties: boolean };
}

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
};

function requireAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다. 설정에서 API 키를 등록하세요.');
  }
  return key;
}

function designToolName(id: string): string {
  return designToolNativeName(id);
}

function designToolIdFromName(name: string) {
  return designToolIdFromNativeName(name);
}

export function anthropicDesignToolDefinitions(): AnthropicToolDefinition[] {
  return listNativeToolDescriptions().map((tool) => ({
    name: tool.name,
    description: `${tool.description} Args: ${tool.args}`,
    input_schema: { type: 'object', properties: {}, additionalProperties: true },
  }));
}

function toAnthropicHistory(messages: ChatMessage[]): AnthropicMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

async function callAnthropicMessages(input: {
  model: string;
  system: string;
  messages: AnthropicMessage[];
  tools: AnthropicToolDefinition[];
  temperature: number;
  abortSignal?: AbortSignal;
}): Promise<{
  content: AnthropicContentBlock[];
  stop_reason?: string | null;
}> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': requireAnthropicApiKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    signal: input.abortSignal,
    body: JSON.stringify({
      model: input.model,
      max_tokens: 4096,
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      temperature: input.temperature,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Anthropic API 호출 실패 (${response.status})`);
  }
  const data = (await response.json()) as {
    content?: AnthropicContentBlock[];
    stop_reason?: string | null;
  };
  return {
    content: data.content ?? [],
    stop_reason: data.stop_reason,
  };
}

function textFromContent(content: AnthropicContentBlock[]): string {
  return content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/** Native Anthropic tool_use loop for read-only workspace chat. */
export async function runAnthropicNativeWorkspaceChat(
  options: AnthropicNativeChatOptions,
): Promise<string> {
  const loopMessages: ChatMessage[] = [...options.messages];
  if (!hasDesignToolResults(loopMessages)) {
    loopMessages.push(...(await bootstrapDesignToolMessages(options.designToolContext)));
  }

  const anthropicMessages = toAnthropicHistory(loopMessages);
  anthropicMessages.push({ role: 'user', content: options.userMessage.trim() });

  const tools = anthropicDesignToolDefinitions();
  const temperature = options.temperature ?? 0.3;

  for (let round = 0; round < NATIVE_TOOL_MAX_ROUNDS; round += 1) {
    options.onProgress?.({
      message: round === 0 ? '연결된 리소스를 확인하고 있습니다…' : '답변을 정리하고 있습니다…',
    });

    const response = await callAnthropicMessages({
      model: options.model,
      system: options.system,
      messages: anthropicMessages,
      tools,
      temperature,
      abortSignal: options.abortSignal,
    });

    const toolUses = response.content.filter(
      (block): block is Extract<typeof block, { type: 'tool_use' }> => block.type === 'tool_use',
    );

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = textFromContent(response.content);
      if (!text) throw new Error('Anthropic API 응답이 비어 있습니다.');
      return text;
    }

    if (toolUses.length > MAX_DESIGN_TOOL_CALLS_PER_TURN) {
      throw new Error(`too_many_design_tool_calls:${MAX_DESIGN_TOOL_CALLS_PER_TURN}`);
    }

    options.onProgress?.({ message: '리소스를 조회하고 있습니다…' });
    anthropicMessages.push({ role: 'assistant', content: response.content });

    const toolResults: AnthropicContentBlock[] = [];
    for (const toolUse of toolUses) {
      const toolId = designToolIdFromName(toolUse.name);
      const result = await executeDesignTool(
        { tool: toolId, args: toolUse.input ?? {} },
        options.designToolContext,
      );
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: JSON.stringify(result),
      });
    }
    anthropicMessages.push({ role: 'user', content: toolResults });
  }

  return '연결된 리소스를 확인했지만 답변을 마무리하지 못했습니다. 질문을 조금 더 구체적으로 해 주세요.';
}
