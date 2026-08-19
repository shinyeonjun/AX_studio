import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject, generateText } from 'ai';
import type { ModelProvider, ModelProviderConfig, StructuredGenerateInput, TextGenerateInput } from './provider.js';

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name = 'openai-compatible';
  private client: ReturnType<typeof createOpenAICompatible>;

  constructor(private config: ModelProviderConfig) {
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
      prompt: input.user,
      temperature: input.temperature ?? 0.2,
    });
    return result.object as T;
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    const result = await generateText({
      model: this.client(this.config.model),
      system: input.system,
      prompt: input.user,
      temperature: input.temperature ?? 0.3,
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
    return `Mock response to: ${input.user.slice(0, 80)}`;
  }
}
