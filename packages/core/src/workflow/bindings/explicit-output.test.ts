import { describe, expect, it } from 'vitest';
import { applyStepBindings, inferWorkflowBindings } from '../bindings.js';
import type { WorkflowIR } from '../schema.js';

describe('inferWorkflowBindings explicit AI output', () => {
  it('keeps an explicit custom AI output binding for notification text', () => {
    const ir: WorkflowIR = {
      id: 'wf-explicit-ai-output',
      name: '명시적 AI 결과',
      goal: '선택한 분류값 전송',
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
          bindings: { text: { from: 'classify', output: 'riskLevel' } },
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
        { classify: { riskLevel: 'high', conclusion: '전체 결론' } },
        {},
      ).text,
    ).toBe('high');
  });

  it('resolves an AI output binding to the declared field', () => {
    const ir: WorkflowIR = {
      id: 'wf-ai',
      name: 'AI output',
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
          params: { channel: '#ax', text: '' },
          bindings: { text: { from: 'classify', output: 'riskLevel' } },
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

    const step = ir.steps[1]!;
    expect(
      applyStepBindings(
        step as Extract<WorkflowIR['steps'][number], { type: 'action' }>,
        ir,
        step.type === 'action' ? step.params : {},
        { classify: { riskLevel: 'high' } },
        {},
      ).text,
    ).toBe('high');
  });
});
