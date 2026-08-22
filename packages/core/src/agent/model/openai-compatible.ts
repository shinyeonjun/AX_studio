import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject, generateText } from 'ai';
import type { CoreMessage } from 'ai';
import { chatMessagesFromInput } from './chat.js';
import type { ModelProvider, ModelProviderConfig, StructuredGenerateInput, TextGenerateInput } from './provider.js';

export function toSdkMessages(input: {
  system: string;
  user?: string;
  messages?: import('./chat.js').ChatMessage[];
  images?: import('./provider.js').ModelImageInput[];
}): CoreMessage[] {
  const messages = chatMessagesFromInput(input);
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUserIndex = index;
  });
  return messages.map((message, index): CoreMessage => {
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
    const result = await generateObject({
      model: this.client(this.config.model),
      schema: input.schema,
      system: input.system,
      messages: toSdkMessages(input),
      temperature: input.temperature ?? 0.2,
      abortSignal: input.abortSignal,
    });
    return result.object as T;
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    const result = await generateText({
      model: this.client(this.config.model),
      system: input.system,
      messages: toSdkMessages(input),
      temperature: input.temperature ?? 0.3,
      abortSignal: input.abortSignal,
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
