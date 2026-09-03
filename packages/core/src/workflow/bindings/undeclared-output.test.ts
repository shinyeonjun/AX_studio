import { describe, expect, it } from 'vitest';
import { applyStepBindings, inferWorkflowBindings } from '../bindings.js';
import type { WorkflowIR } from '../schema.js';

describe('inferWorkflowBindings undeclared AI output', () => {
  it('does not turn an undeclared AI summary into message text', () => {
    const ir: WorkflowIR = {
      id: 'wf-ai-no-fallback',
      name: 'AI output contract',
      goal: '분류 결과 전송',
      version: 1,
      trigger: { type: 'manual' },
      inputs: [],
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '분류',
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax' },
          bindings: { text: { from: 'classify', output: 'summary' } },
          sideEffect: 'EXTERNAL',
        },
      ],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const notify = ir.steps[1]!;
    expect(
      applyStepBindings(
        notify as Extract<WorkflowIR['steps'][number], { type: 'action' }>,
        ir,
        { channel: '#ax' },
        { classify: { conclusion: '암묵 요약' } },
        {},
      ).text,
    ).toBeUndefined();
  });
});
