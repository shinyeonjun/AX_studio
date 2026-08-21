import { describe, expect, it } from 'vitest';
import { createAgentHarness } from '../agent/harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../agent/model/provider.js';
import type { ConnectorContext } from '../modules/types.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { resolveStepParams, runAiDecision } from './ai-investigation.js';

describe('resolveStepParams', () => {
  it('interpolates only explicitly declared parameter values', () => {
    const params = resolveStepParams(
      {
        channel: '#ax테스트',
        text: '📧 {{trigger.subject}}\n\n{{summarize.summary}}',
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
    expect(params).not.toHaveProperty('message');
  });

  it('resolves nested ref objects and first matching item in list results', () => {
    const params = resolveStepParams(
      {
        messageId: { ref: 'search-mails.messageId' },
        text: { ref: 'summarize-mails.summary' },
      },
      { executionId: 'exec-1', variables: {}, log: () => {} },
      {
        'search-mails': [{ id: 'message-1', threadId: 'thread-1' }],
        'summarize-mails': { summary: '요약 결과' },
      },
    );

    expect(params).toEqual({ messageId: 'message-1', text: '요약 결과' });
  });

  it('fails closed when a template reference is missing', () => {
    expect(() =>
      resolveStepParams(
        { text: '{{classify.summary}}' },
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { classify: { riskLevel: 'high' } },
      ),
    ).toThrow(/classify\.summary/);
  });

  it('fails closed when an object binding reference is missing', () => {
    expect(() =>
      resolveStepParams(
        { payload: { ref: 'classify.riskLevel' } },
        { executionId: 'exec-1', variables: {}, log: () => {} },
        { classify: {} },
      ),
    ).toThrow(/classify\.riskLevel/);
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
    expect(results.summarize).toMatchObject({ conclusion: '요약 완료' });
    expect(results.summarize).not.toHaveProperty('summary');
  });
});
