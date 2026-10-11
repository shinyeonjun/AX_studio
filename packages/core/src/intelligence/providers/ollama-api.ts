import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from './provider.js';

/** OpenAI-compatible endpoint; accepts `host:port`, `http://host:port`, and `.../v1` forms. */
export function ollamaApiBaseUrl(): string {
  const configured = process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_HOST?.trim();
  const base = (configured || 'http://localhost:11434').replace(/\/+$/, '');
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(base) ? base : `http://${base}`;
  return withScheme.endsWith('/v1') ? withScheme : `${withScheme}/v1`;
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
      baseURL: ollamaApiBaseUrl(),
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
