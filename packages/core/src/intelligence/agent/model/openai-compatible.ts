import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import type { ModelMessage } from 'ai';
import { chatMessagesFromInput } from './chat.js';
import type { ModelProvider, ModelProviderConfig, StructuredGenerateInput, TextGenerateInput } from './provider.js';

export function toSdkMessages(input: {
  system: string;
  user?: string;
  messages?: import('./chat.js').ChatMessage[];
  images?: import('./provider.js').ModelImageInput[];
}): ModelMessage[] {
  const messages = chatMessagesFromInput(input);
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUserIndex = index;
  });
  return messages.map((message, index): ModelMessage => {
    if (index !== lastUserIndex || !input.images?.length) {
      return message.role === 'assistant'
        ? { role: 'assistant', content: message.content }
        : { role: 'user', content: message.content };
    }
    return {
      role: 'user',
      content: [
        { type: 'text' as const, text: message.content },
        ...input.images.map((image) => ({
          type: 'image' as const,
          image: image.data,
          mediaType: image.mimeType,
        })),
      ],
    };
  });
}

function requestSignal(input: { timeoutMs?: number; abortSignal?: AbortSignal }): AbortSignal | undefined {
  if (input.timeoutMs === undefined) return input.abortSignal;
  const timeout = AbortSignal.timeout(Math.ceil(input.timeoutMs));
  return input.abortSignal ? AbortSignal.any([input.abortSignal, timeout]) : timeout;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name = 'openai-compatible';
  readonly supportsVision = true;
  readonly model: string;
  private client: ReturnType<typeof createOpenAICompatible>;

  constructor(private config: ModelProviderConfig) {
    this.model = config.model;
    this.client = createOpenAICompatible({
      name: 'ax-studio',
      baseURL: config.baseURL,
      apiKey: config.apiKey ?? 'ollama',
    });
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    // Preserve the tool-call contract used by compatible APIs, including Ollama.
    // SDK 5 generateObject uses JSON response_format instead of the old tool mode.
    const result = await generateText({
      model: this.client(this.config.model),
      tools: { json: { inputSchema: input.schema } },
      toolChoice: { type: 'tool', toolName: 'json' },
      system: input.system,
      messages: toSdkMessages(input),
      temperature: input.temperature ?? 0.2,
      abortSignal: requestSignal(input),
    });
    const response = result.toolCalls.find((call) => call.toolName === 'json');
    if (!response) throw new Error('Model did not return the requested structured response');
    return input.schema.parse(response.input);
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    const result = await generateText({
      model: this.client(this.config.model),
      system: input.system,
      messages: toSdkMessages(input),
      temperature: input.temperature ?? 0.3,
      abortSignal: requestSignal(input),
    });
    return result.text;
  }
}

export class MockModelProvider implements ModelProvider {
  readonly name = 'mock';
  responses: Record<string, unknown> = {};

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const key = input.system.slice(0, 50);
    if (this.responses[key]) return this.responses[key] as T;
    throw new Error(`No mock response for: ${key}`);
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return `Mock response to: ${input.user?.slice(0, 80) ?? input.messages?.at(-1)?.content.slice(0, 80) ?? ''}`;
  }
}
