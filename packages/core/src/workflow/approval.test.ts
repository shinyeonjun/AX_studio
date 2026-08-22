import { describe, expect, it } from 'vitest';
import { requiresApproval } from './approval.js';
import { summarizeApprovalGates } from './approval-gates.js';
import { resolveEffectiveSideEffect } from './side-effect-resolve.js';
import type { ActionDefinition } from './action-definition.js';
import type { WorkflowIR } from './schema.js';

const httpRequest: ActionDefinition = {
  id: 'http.request',
  version: 1,
  connector: 'http',
  action: 'request',
  kind: 'read',
  params: [],
};

function minimalWorkflow(overrides: Partial<WorkflowIR> = {}): WorkflowIR {
  return {
    name: 'gate test',
    goal: 'verify approval matrix',
    version: 1,
    steps: [
      {
        type: 'action',
        id: 'notify',
        connector: 'slack',
        action: 'message.send',
        params: { channel: '#ops', text: 'hi' },
        sideEffect: 'EXTERNAL',
      },
      {
        type: 'action',
        id: 'send_mail',
        connector: 'gmail',
        action: 'message.send',
        params: { to: 'a@b.com', body: 'body' },
        sideEffect: 'EXTERNAL_HIGH',
      },
    ],
    permissions: {},
    approval: [],
    allowExternalAuto: false,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
    ...overrides,
  };
}

describe('approval matrix', () => {
  it('requires EXTERNAL approval by default and never relaxes EXTERNAL_HIGH', () => {
    expect(requiresApproval('EXTERNAL', false)).toBe(true);
    expect(requiresApproval('EXTERNAL', true)).toBe(false);
    expect(requiresApproval('EXTERNAL_HIGH', false)).toBe(true);
    expect(requiresApproval('EXTERNAL_HIGH', true)).toBe(true);
    expect(requiresApproval('NONE', false)).toBe(false);
  });

  it('summarizes gated actions for review', () => {
    const summary = summarizeApprovalGates(minimalWorkflow());
    expect(summary.externalCount).toBe(1);
    expect(summary.highRiskCount).toBe(1);
    expect(summary.gates.find((gate) => gate.stepId === 'notify')?.requiresApproval).toBe(true);
    expect(summary.gates.find((gate) => gate.stepId === 'send_mail')?.requiresApproval).toBe(true);
  });

  it('relaxes EXTERNAL only when allowExternalAuto is enabled', () => {
    const relaxed = summarizeApprovalGates(minimalWorkflow({ allowExternalAuto: true }));
    expect(relaxed.gates.find((gate) => gate.stepId === 'notify')?.requiresApproval).toBe(false);
    expect(relaxed.gates.find((gate) => gate.stepId === 'send_mail')?.requiresApproval).toBe(true);
  });

  it('does not use HTTP method as approval source when catalog sideEffect is fixed', () => {
    const fixedHigh = { ...httpRequest, sideEffect: 'EXTERNAL_HIGH' as const };
    expect(resolveEffectiveSideEffect(fixedHigh, { method: 'GET' })).toBe('EXTERNAL_HIGH');
    expect(requiresApproval('EXTERNAL_HIGH', true)).toBe(true);
  });
});
