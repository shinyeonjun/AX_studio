import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from './provider.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

const XAI_BASE_URL = process.env.XAI_BASE_URL?.trim() || 'https://api.x.ai/v1';

export class GrokApiProvider implements ModelProvider {
  readonly name = 'grok-api';
  private inner: OpenAICompatibleProvider;

  constructor(model: string) {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('XAI_API_KEY가 설정되지 않았습니다. 설정에서 xAI API 키를 등록하세요.');
    }
    this.inner = new OpenAICompatibleProvider({
      baseURL: XAI_BASE_URL,
      apiKey,
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

export function isXaiApiKeyConfigured(): boolean {
  return Boolean(process.env.XAI_API_KEY?.trim());
}
