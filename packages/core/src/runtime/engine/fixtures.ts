import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../agent/model/provider.js';

export class NoReadProvider implements ModelProvider {
  readonly name = 'test-agent';

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    return input.schema.parse({ needMore: false, conclusion: '주간 보고 결과', changeRate: 0 }) as T;
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

export class RiskProvider implements ModelProvider {
  readonly name = 'risk-test-agent';

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    return input.schema.parse({ needMore: false, riskLevel: 'normal' }) as T;
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}
