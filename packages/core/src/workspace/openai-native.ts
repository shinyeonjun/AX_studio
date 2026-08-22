import type { ChatMessage } from '../agent/model/chat.js';
import type { AgentProgressEvent } from '../agent/progress.js';
import {
  executeDesignTool,
  type DesignToolContext,
} from '../design-tools/index.js';
import { designToolIdFromNativeName, listNativeToolDescriptions } from '../design-tools/native-tools.js';
import { bootstrapDesignToolMessages, hasDesignToolResults } from '../design-tools/bootstrap.js';
import { MAX_DESIGN_TOOL_CALLS_PER_TURN } from '../design-tools/types.js';

const NATIVE_TOOL_MAX_ROUNDS = 5;

export interface OpenAiNativeChatOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  userMessage: string;
  designToolContext: DesignToolContext;
  temperature?: number;
  abortSignal?: AbortSignal;
  onProgress?: (event: AgentProgressEvent) => void;
}

type OpenAiToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function openAiToolDefinitions() {
  return listNativeToolDescriptions().map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: `${tool.description} Args: ${tool.args}`,
      parameters: { type: 'object', additionalProperties: true },
    },
  }));
}

function toOpenAiHistory(messages: ChatMessage[]): OpenAiMessage[] {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

async function callOpenAi(input: {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: OpenAiMessage[];
  temperature: number;
  abortSignal?: AbortSignal;
}): Promise<{
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}> {
  const response = await fetch(`${input.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json',
    },
    signal: input.abortSignal,
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      tools: openAiToolDefinitions(),
      tool_choice: 'auto',
      temperature: input.temperature,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `OpenAI API 호출 실패 (${response.status})`);
  }
  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: OpenAiToolCall[];
      };
    }>;
  };
  const message = data.choices?.[0]?.message;
  return {
    content: message?.content?.trim() ?? null,
    tool_calls: message?.tool_calls,
  };
}

/** Native OpenAI-compatible function-calling loop for read-only workspace chat. */
export async function runOpenAiNativeWorkspaceChat(options: OpenAiNativeChatOptions): Promise<string> {
  const loopMessages: ChatMessage[] = [...options.messages];
  if (!hasDesignToolResults(loopMessages)) {
    loopMessages.push(...(await bootstrapDesignToolMessages(options.designToolContext)));
  }

  const apiMessages: OpenAiMessage[] = [
    { role: 'system', content: options.system },
    ...toOpenAiHistory(loopMessages),
    { role: 'user', content: options.userMessage.trim() },
  ];
  const temperature = options.temperature ?? 0.3;

  for (let round = 0; round < NATIVE_TOOL_MAX_ROUNDS; round += 1) {
    options.onProgress?.({
      message: round === 0 ? '연결된 리소스를 확인하고 있습니다…' : '답변을 정리하고 있습니다…',
    });

    const response = await callOpenAi({
      baseURL: options.baseURL,
      apiKey: options.apiKey,
      model: options.model,
      messages: apiMessages,
      temperature,
      abortSignal: options.abortSignal,
    });

    if (!response.tool_calls?.length) {
      if (!response.content) throw new Error('OpenAI API 응답이 비어 있습니다.');
      return response.content;
    }

    if (response.tool_calls.length > MAX_DESIGN_TOOL_CALLS_PER_TURN) {
      throw new Error(`too_many_design_tool_calls:${MAX_DESIGN_TOOL_CALLS_PER_TURN}`);
    }

    options.onProgress?.({ message: '리소스를 조회하고 있습니다…' });
    apiMessages.push({
      role: 'assistant',
      content: response.content,
      tool_calls: response.tool_calls,
    });

    for (const toolCall of response.tool_calls) {
      const toolId = designToolIdFromNativeName(toolCall.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>;
      } catch {
        args = {};
      }
      const result = await executeDesignTool({ tool: toolId, args }, options.designToolContext);
      apiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return '연결된 리소스를 확인했지만 답변을 마무리하지 못했습니다. 질문을 조금 더 구체적으로 해 주세요.';
}
