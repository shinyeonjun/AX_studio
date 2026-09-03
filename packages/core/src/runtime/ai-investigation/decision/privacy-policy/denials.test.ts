import { describe, expect, it } from 'vitest';
import { createAgentHarness, createInvestigationRunner } from '../../../../agent/harness.js';
import { runAiDecision } from '../../../ai-investigation.js';
import { PrivacyCaptureProvider, decisionWorkflow as ir } from '../fixtures.js';

describe('runAiDecision privacy policy denials', () => {
  it('does not send email or document content to a cloud provider when cloudAllowed is false', async () => {
    const model = new PrivacyCaptureProvider();
    const privacyIr = { ...ir, dataPolicy: { emailBody: { cloudAllowed: false } } };
    await runAiDecision(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        investigation: false,
        maxReads: 1,
        outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
      },
      privacyIr,
      { executionId: 'exec-1', variables: { subject: 'SECRET-SUBJECT' }, log: () => {} },
      { read: { body: 'SECRET-BODY' }, document: { text: 'SECRET-PDF-TEXT' } },
      createInvestigationRunner(createAgentHarness(model)),
      {},
    );

    expect(model.captured?.user).not.toContain('SECRET-SUBJECT');
    expect(model.captured?.user).not.toContain('SECRET-BODY');
    expect(model.captured?.user).not.toContain('SECRET-PDF-TEXT');
    expect(model.captured?.system).not.toContain('SECRET-BODY');
    expect(model.captured?.system).not.toContain('SECRET-PDF-TEXT');
  });

  it('fails closed instead of classifying a PDF when the cloud policy hides its content', async () => {
    const model = new PrivacyCaptureProvider();
    const documentIr = {
      ...ir,
      dataPolicy: { document: { cloudAllowed: false } },
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

    await expect(
      runAiDecision(
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
        { ingest: { text: 'PDF evidence' } },
        createInvestigationRunner(createAgentHarness(model)),
        {},
      ),
    ).rejects.toMatchObject({ code: 'ai_input_unavailable' });
    expect(model.captured).toBeUndefined();
  });

  it('does not let document consent override a separate email-body policy', async () => {
    const model = new PrivacyCaptureProvider();
    const documentIr = {
      ...ir,
      dataPolicy: {
        document: { cloudAllowed: true },
        emailBody: { cloudAllowed: false },
      },
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

    await expect(
      runAiDecision(
        {
          type: 'ai_decision',
          id: 'classify',
          goal: 'PDF 위험도 분류',
          investigation: false,
          maxReads: 1,
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
        },
        documentIr,
        { executionId: 'exec-1', variables: { body: 'SECRET-EMAIL-BODY' }, log: () => {} },
        { ingest: { text: 'EXPLICIT-PDF-EVIDENCE' } },
        createInvestigationRunner(createAgentHarness(model)),
        {},
      ),
    ).rejects.toMatchObject({ code: 'ai_input_unavailable' });
    expect(model.captured).toBeUndefined();
  });
});
