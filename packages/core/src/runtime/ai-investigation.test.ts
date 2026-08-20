import { describe, expect, it } from 'vitest';
import { createAgentHarness } from '../agent/harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../agent/model/provider.js';
import type { ConnectorContext } from '../modules/types.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { resolveStepParams, runAiDecision } from './ai-investigation.js';

describe('resolveStepParams', () => {
  it('interpolates trigger and step result templates and maps message to text', () => {
    const params = resolveStepParams(
      {
        channel: '#ax테스트',
        message: '📧 {{trigger.subject}}\n\n{{summarize.summary}}',
      },
      {
        executionId: 'exec-1',
        variables: { subject: '테스트' },
        log: () => {},
      },
      {
        summarize: { summary: '요약 본문' },
      },
    );

    expect(params.text).toBe('📧 테스트\n\n요약 본문');
    expect(params.channel).toBe('#ax테스트');
  });
});

class CountingProvider implements ModelProvider {
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

describe('runAiDecision', () => {
  const ir = {
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
  const ctx: ConnectorContext = { executionId: 'exec-1', variables: {}, log: () => {} };

  it('does not follow extra reads when investigation is off', async () => {
    const model = new CountingProvider();
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'summarize',
        goal: 'PDF 요약',
        investigation: false,
        maxReads: 4,
        outputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
      },
      ir,
      ctx,
      results,
      createAgentHarness(model),
      {},
    );
    expect(model.calls).toBe(1);
    expect(results.summarize).toMatchObject({ conclusion: '요약 완료', summary: '요약 완료' });
  });
});
