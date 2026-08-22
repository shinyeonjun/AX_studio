import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from './provider.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';

export class OpenAiApiProvider implements ModelProvider {
  readonly name = 'openai-api';
  readonly supportsVision = true;
  readonly model: string;
  private inner: OpenAICompatibleProvider;

  constructor(model: string) {
    this.model = model;
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY가 설정되지 않았습니다. 설정에서 API 키를 등록하세요.');
    }
    this.inner = new OpenAICompatibleProvider({
      baseURL: 'https://api.openai.com/v1',
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

export function isOpenAiApiKeyConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
