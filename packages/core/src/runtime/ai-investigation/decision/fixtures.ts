import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../../agent/model/provider.js';
import type { ConnectorContext } from '../../../modules/types.js';
import type { WorkflowIR } from '../../../workflow/schema.js';

export class CountingProvider implements ModelProvider {
  readonly name = 'fake';
  calls = 0;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls += 1;
    return input.schema.parse({
      needMore: true,
      nextRead: 'gmail.messages.read',
      conclusion: '요약 완료',
    });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

export class PrivacyCaptureProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  captured?: StructuredGenerateInput<unknown>;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.captured = input as StructuredGenerateInput<unknown>;
    return input.schema.parse({ needMore: false, conclusion: '분류 완료', riskLevel: 'normal' });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

export class InvestigationProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  calls = 0;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls += 1;
    return input.schema.parse(
      this.calls === 1
        ? { needMore: true, nextRead: 'gmail.messages.read', nextReadParams: { messageId: 'm1' } }
        : { needMore: false, conclusion: '분류 완료', riskLevel: 'high' },
    );
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

export class IncompleteConclusionProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  calls = 0;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls += 1;
    return input.schema.parse(
      this.calls === 1
        ? { needMore: false, reason: '추가 근거가 필요하지만 읽기 없이 결론을 요청받음' }
        : { needMore: false, conclusion: '분류 완료', riskLevel: 'critical' },
    );
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

export class VisionCaptureProvider implements ModelProvider {
  readonly name = 'openai-compatible';
  readonly supportsVision = true;
  captured?: StructuredGenerateInput<unknown>;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.captured = input as StructuredGenerateInput<unknown>;
    return input.schema.parse({ needMore: false, conclusion: '이미지 분석 완료', riskLevel: 'high' });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}


export const decisionWorkflow = {
    version: 1,
    name: 'pdf',
    goal: '요약',
    steps: [],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
    inputs: [],
  } as WorkflowIR;
export const decisionContext: ConnectorContext = { executionId: 'exec-1', variables: {}, log: () => {} };
