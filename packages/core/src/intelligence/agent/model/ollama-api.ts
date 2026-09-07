import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from './provider.js';

function ollamaBaseUrl(): string {
  const configured = process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_HOST?.trim();
  const base = configured || 'http://localhost:11434';
  return `${base.replace(/\/$/, '')}${base.endsWith('/v1') ? '' : '/v1'}`;
}

/** Ollama's local OpenAI-compatible `/v1` API. No API key is required. */
export class OllamaApiProvider implements ModelProvider {
  readonly name = 'ollama-api';
  readonly supportsVision = true;
  readonly model: string;
  private inner: OpenAICompatibleProvider;

  constructor(model: string) {
    this.model = model;
    this.inner = new OpenAICompatibleProvider({
      baseURL: ollamaBaseUrl(),
      apiKey: process.env.OLLAMA_API_KEY?.trim() || 'ollama',
      model,
    });
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    return this.inner.generateStructured(input);
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return this.inner.generateText(input);
  }
}

export function ollamaApiBaseUrl(): string {
  return ollamaBaseUrl();
}
