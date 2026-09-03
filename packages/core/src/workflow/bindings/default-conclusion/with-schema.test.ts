import { describe, expect, it } from 'vitest';
import { applyStepBindings, inferWorkflowBindings } from '../../bindings.js';
import type { WorkflowIR } from '../../schema.js';
describe('default AI conclusion with schema', () => {
  it('prefers the default AI conclusion for implicit notification text', () => {
    const ir: WorkflowIR = {
      id: 'wf-ai-contract', name: 'AI output contract', goal: '분류 결과 전송', version: 1,
      trigger: { type: 'manual' }, inputs: [],
      steps: [
        { type: 'ai_decision', id: 'classify', goal: '분류', outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } }, investigation: false, maxReads: 1 },
        { type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ax' }, sideEffect: 'EXTERNAL' },
      ],
      permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
    };
    const inferred = inferWorkflowBindings(ir);
    const notify = inferred.steps.find((step) => step.id === 'notify');
    expect(notify?.type === 'action' && notify.bindings?.text).toEqual({ from: 'classify', output: 'conclusion' });
    expect(applyStepBindings(notify as Extract<WorkflowIR['steps'][number], { type: 'action' }>, ir, { channel: '#ax' }, { classify: { riskLevel: 'high', conclusion: '위험도 높음' } }, {}).text).toBe('위험도 높음');
  });
});
