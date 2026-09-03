import { describe, expect, it } from 'vitest';
import { createAgentHarness, createInvestigationRunner } from '../../../agent/harness.js';
import { runAiDecision } from '../../ai-investigation.js';
import {
  CountingProvider,
  IncompleteConclusionProvider,
  InvestigationProvider,
  decisionContext as ctx,
  decisionWorkflow as ir,
} from './fixtures.js';



describe('runAiDecision investigation flow', () => {

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
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );
    expect(model.calls).toBe(1);
    expect(results.summarize).toMatchObject({ conclusion: '요약 완료' });
    expect(results.summarize).not.toHaveProperty('summary');
  });


  it('allows investigation reads before requiring declared final output fields', async () => {
    const model = new InvestigationProvider();
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        investigation: true,
        maxReads: 2,
        outputSchema: {
          type: 'object',
          properties: { riskLevel: { type: 'string' } },
          required: ['riskLevel'],
        },
      },
      { ...ir, dataPolicy: { emailBody: { cloudAllowed: false } } },
      { executionId: 'exec-1', variables: {}, log: () => {} },
      results,
      createInvestigationRunner(createAgentHarness(model)),
      { gmail: { name: 'gmail', execute: async () => ({ ok: true, data: { body: 'evidence' } }) } },
    );

    expect(model.calls).toBe(2);
    expect(results.classify).toMatchObject({ riskLevel: 'high' });
  });


  it('repairs an incomplete terminal investigation output before storing it', async () => {
    const model = new IncompleteConclusionProvider();
    const results: Record<string, unknown> = {};
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        investigation: true,
        maxReads: 2,
        outputSchema: {
          type: 'object',
          properties: { riskLevel: { type: 'string' } },
          required: ['riskLevel'],
        },
      },
      { ...ir, dataPolicy: { emailBody: { cloudAllowed: false } } },
      { executionId: 'exec-1', variables: {}, log: () => {} },
      results,
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.calls).toBe(2);
    expect(results.classify).toMatchObject({ riskLevel: 'critical' });
  });


});
