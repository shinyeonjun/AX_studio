import { describe, expect, it } from 'vitest';
import { createAgentHarness, createInvestigationRunner } from '../../../../agent/harness.js';
import { runAiDecision } from '../../../ai-investigation.js';
import { PrivacyCaptureProvider, decisionWorkflow as ir } from '../fixtures.js';

describe('runAiDecision privacy policy allowances', () => {
  it('allows document evidence by default when no cloud policy is specified', async () => {
    const model = new PrivacyCaptureProvider();
    const documentIr = {
      ...ir,
      dataPolicy: {},
      steps: [
        {
          type: 'action' as const,
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: {},
          sideEffect: 'NONE' as const,
        },
      ],
    };

    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: 'PDF 위험도 분류',
        investigation: false,
        maxReads: 1,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
      },
      documentIr,
      { executionId: 'exec-1', variables: {}, log: () => {} },
      { ingest: { text: 'DEFAULT-PDF-EVIDENCE' } },
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.captured?.user).toContain('DEFAULT-PDF-EVIDENCE');
  });

  it('allows document evidence when cloud transfer is explicitly allowed', async () => {
    const model = new PrivacyCaptureProvider();
    const documentIr = {
      ...ir,
      dataPolicy: { document: { cloudAllowed: true } },
      steps: [
        {
          type: 'action' as const,
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: {},
          sideEffect: 'NONE' as const,
        },
      ],
    };

    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: 'PDF 위험도 분류',
        investigation: false,
        maxReads: 1,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
      },
      documentIr,
      { executionId: 'exec-1', variables: {}, log: () => {} },
      { ingest: { text: 'EXPLICIT-PDF-EVIDENCE' } },
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.captured?.user).toContain('EXPLICIT-PDF-EVIDENCE');
  });
});
