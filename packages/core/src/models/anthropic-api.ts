import type { ZodType } from 'zod';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from './provider.js';
import { parseStructuredOutput } from './cli-json.js';

function requireAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다. 설정에서 API 키를 등록하세요.');
  }
  return key;
}

async function callAnthropic(model: string, system: string, user: string, temperature: number): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': requireAnthropicApiKey(),
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
      temperature,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Anthropic API 호출 실패 (${response.status})`);
  }
  const data = (await response.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((block) => block.type === 'text')?.text?.trim();
  if (!text) throw new Error('Anthropic API 응답이 비어 있습니다.');
  return text;
}

export class AnthropicApiProvider implements ModelProvider {
  readonly name = 'anthropic-api';

  constructor(private model: string) {}

  async generateText(input: TextGenerateInput): Promise<string> {
    return callAnthropic(this.model, input.system, input.user, input.temperature ?? 0.3);
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const prompt = `${input.user}\n\nReturn JSON only that matches the schema. No markdown.`;
    const text = await callAnthropic(this.model, input.system, prompt, input.temperature ?? 0.2);
    return parseStructuredOutput(text, input.schema);
  }
}

export function isAnthropicApiKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
