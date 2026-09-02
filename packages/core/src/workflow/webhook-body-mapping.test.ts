import { describe, expect, it } from 'vitest';
import type { ConnectorContext } from '../modules/types.js';
import { buildInvestigationUser } from '../runtime/ai-investigation.js';
import { inferWorkflowBindings } from './bindings.js';
import type { WorkflowIR } from './schema.js';

const webhookWorkflow: WorkflowIR = {
  id: 'wf-webhook-body',
  name: '결제 요약',
  goal: 'Webhook 결제 본문을 요약한다',
  version: 1,
  trigger: { type: 'webhook.inbound', path: 'invoice-paid' },
  inputs: ['path', 'body'],
  steps: [
    {
      type: 'ai_decision',
      id: 'summarize',
      goal: 'invoiceId, amount, status를 한국어로 요약한다',
      outputSchema: {
        type: 'object',
        properties: {
          conclusion: { type: 'string' },
        },
      },
      investigation: false,
      maxReads: 1,
    },
  ],
  permissions: {},
  approval: [],
  allowExternalAuto: true,
  assumptions: [],
  sideEffects: {},
  dataPolicy: {},
};

describe('Webhook body binding', () => {
  it('prefers the provider body over the route path for AI text input', () => {
    const inferred = inferWorkflowBindings(webhookWorkflow);
    const step = inferred.steps[0];
    if (step?.type !== 'ai_decision') throw new Error('missing AI step');

    expect(step.bindings).toMatchObject({
      sourceText: { from: 'trigger', output: 'body' },
      emailBody: { from: 'trigger', output: 'body' },
    });
  });

  it('puts the JSON body, not only the route name, into the investigation prompt', () => {
    const inferred = inferWorkflowBindings(webhookWorkflow);
    const step = inferred.steps[0];
    if (step?.type !== 'ai_decision') throw new Error('missing AI step');

    const body = JSON.stringify({
      data: { invoiceId: 'inv_acme_1001', amount: 42000, status: 'paid' },
    });
    const ctx: ConnectorContext = {
      executionId: 'execution-webhook-body',
      workflowId: webhookWorkflow.id,
      variables: { path: 'invoice-paid', body },
      log: () => undefined,
    };

    const prompt = buildInvestigationUser(step, ctx, {}, { ir: inferred });

    expect(prompt).toContain('inv_acme_1001');
    expect(prompt).toContain('42000');
    expect(prompt).toContain('paid');
    expect(prompt).not.toContain('Body:\ninvoice-paid');
  });
});
