import { describe, expect, it, vi } from 'vitest';
import { createAgentHarness, createInvestigationRunner } from '../../../../intelligence/agent/harness.js';
import { runAiDecision } from '../../../ai-investigation.js';
import { cloudDataAllowedForReadSource, withContentKeptLocal } from '../../../investigation/evidence.js';
import { PrivacyCaptureProvider, decisionWorkflow as ir } from '../fixtures.js';

const step = {
  type: 'ai_decision' as const,
  id: 'classify',
  goal: '위험도 분류',
  investigation: false,
  maxReads: 1,
  outputSchema: { type: 'object' as const, properties: { riskLevel: { type: 'string' as const, purpose: 'prose' as const } } },
};

describe('keeping all work content on this computer', () => {
  it('sends no mail or document content to a cloud AI, whatever the work allows', async () => {
    const model = new PrivacyCaptureProvider();
    await runAiDecision(step, withContentKeptLocal({ ...ir, dataPolicy: { emailBody: { cloudAllowed: true } } }),
      { executionId: 'exec-1', variables: { subject: 'SECRET-SUBJECT' }, log: () => {} },
      { read: { body: 'SECRET-BODY' }, document: { text: 'SECRET-PDF-TEXT' } },
      createInvestigationRunner(createAgentHarness(model)), {});
    for (const secret of ['SECRET-SUBJECT', 'SECRET-BODY', 'SECRET-PDF-TEXT']) {
      expect(model.captured?.user).not.toContain(secret);
      expect(model.captured?.system).not.toContain(secret);
    }
  });

  it('gives a cloud decision engine nothing from the run', async () => {
    const evaluate = vi.fn(async () => ({ answers: {} }));
    const model = new PrivacyCaptureProvider();
    await runAiDecision(step, withContentKeptLocal(ir),
      { executionId: 'exec-1', variables: {}, log: () => {} },
      { read: { body: 'SECRET-BODY' } },
      createInvestigationRunner(createAgentHarness(model)), {},
      { dataHandling: 'cloud', evaluate } as never).catch(() => undefined);
    expect(JSON.stringify(evaluate.mock.calls)).not.toContain('SECRET-BODY');
  });

  it('covers every read source, not only the ones the work names', () => {
    expect(cloudDataAllowedForReadSource(ir, 'gmail.messages.read')).toBe(true);
    expect(cloudDataAllowedForReadSource(withContentKeptLocal(ir), 'gmail.messages.read')).toBe(false);
  });
});

describe('the app-wide setting at run time', () => {
  it('a run reads the person\'s choice and keeps the content local', async () => {
    const { executeStep } = await import('../../../step-executor.js');
    const { KEEP_CONTENT_LOCAL_SETTING } = await import('../../../investigation/evidence.js');
    const model = new PrivacyCaptureProvider();
    const store = { getSetting: (key: string, fallback: unknown) => (key === KEEP_CONTENT_LOCAL_SETTING ? true : fallback) };
    await executeStep(step, ir, { executionId: 'exec-1', variables: { subject: 'SECRET-SUBJECT' }, log: () => {} },
      { read: { body: 'SECRET-BODY' } }, store as never, {}, createInvestigationRunner(createAgentHarness(model)), vi.fn());
    expect(model.captured?.user).not.toContain('SECRET-BODY');
    expect(model.captured?.user).not.toContain('SECRET-SUBJECT');
  });
});
