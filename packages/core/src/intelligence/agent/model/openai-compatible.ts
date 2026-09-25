import type { FlexibleSchema, LanguageModelUsage, ModelMessage } from 'ai';
import { chatMessagesFromInput } from './chat.js';
import { reportModelTokenUsage, type ModelProvider, type ModelProviderConfig, type ModelTokenUsage, type StructuredGenerateInput, type TextGenerateInput } from './provider.js';

function reportSdkUsage(
  input: { onUsage?: (usage: ModelTokenUsage) => void },
  usage: LanguageModelUsage,
): void {
  reportModelTokenUsage(input, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
  });
}

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
          mimeType: image.mimeType,
        })),
      ],
    };
  });
}

type OpenAICompatibleRuntime = {
  client: ReturnType<typeof import('@ai-sdk/openai-compatible')['createOpenAICompatible']>;
  generateObject: typeof import('ai')['generateObject'];
  generateText: typeof import('ai')['generateText'];
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name = 'openai-compatible';
  readonly supportsVision = true;
  readonly model: string;
  private runtimePromise?: Promise<OpenAICompatibleRuntime>;

  constructor(private config: ModelProviderConfig) {
    this.model = config.model;
  }

  private getRuntime(): Promise<OpenAICompatibleRuntime> {
    return this.runtimePromise ??= Promise.all([
      import('@ai-sdk/openai-compatible'),
      import('ai'),
    ]).then(([{ createOpenAICompatible }, { generateObject, generateText }]) => ({
      client: createOpenAICompatible({
        name: 'ax-studio',
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey ?? 'ollama',
      }),
      generateObject,
      generateText,
    }));
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const runtime = await this.getRuntime();
    const result = await runtime.generateObject({
      model: runtime.client(this.config.model),
      schema: input.schema as unknown as FlexibleSchema<unknown>,
      system: input.system,
      messages: toSdkMessages(input),
      temperature: input.temperature ?? 0.2,
      abortSignal: input.abortSignal,
    });
    reportSdkUsage(input, result.usage);
    return result.object as T;
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    const runtime = await this.getRuntime();
    const result = await runtime.generateText({
      model: runtime.client(this.config.model),
      system: input.system,
      messages: toSdkMessages(input),
      temperature: input.temperature ?? 0.3,
      maxOutputTokens: input.maxOutputTokens,
      abortSignal: input.abortSignal,
    });
    reportSdkUsage(input, result.usage);
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
