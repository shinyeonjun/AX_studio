import { describe, expect, it } from 'vitest';
import { applyStepBindings, inferWorkflowBindings } from '../../bindings.js';
import type { WorkflowIR } from '../../schema.js';
describe('default AI conclusion without schema', () => {
  it('uses the default AI conclusion as message text without a custom output schema', () => {
    const ir: WorkflowIR = {
      id: 'wf-default-ai-output', name: '기본 AI 결과', goal: '요약 결과 전송', version: 1,
      trigger: { type: 'manual' }, inputs: [],
      steps: [
        { type: 'ai_decision', id: 'brief', goal: '주문 요약', investigation: false, maxReads: 1 },
        { type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ax' }, sideEffect: 'EXTERNAL' },
      ],
      permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {},
    };
    const inferred = inferWorkflowBindings(ir);
    const notify = inferred.steps.find((step) => step.id === 'notify');
    expect(notify?.type === 'action' && notify.bindings?.text).toEqual({ from: 'brief', output: 'conclusion' });
    expect(applyStepBindings(notify as Extract<WorkflowIR['steps'][number], { type: 'action' }>, inferred, { channel: '#ax' }, { brief: { needMore: false, conclusion: '주문 두 건 요약' } }, {}).text).toBe('주문 두 건 요약');
  });
});
