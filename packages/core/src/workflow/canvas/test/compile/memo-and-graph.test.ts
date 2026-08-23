import { describe, expect, it } from 'vitest';
import { buildIRFromWorkflow } from '../../compile/builder.js';
import { validateCanvasDraftGraph } from '../../compile/validate-graph.js';
import { assessCompleteness } from '../../slots/requiredness.js';

describe('ai_decision memo', () => {
  it('compiles memo onto the ai_decision step', () => {
    const ir = buildIRFromWorkflow({
      name: 'PDF 분류',
      goal: 'PDF 위험도 분류',
      triggerType: 'manual',
      assumptions: [],
      nodes: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: 'PDF 위험도 분류',
          memo: 'critical=즉시 대응\nhigh=운영 영향\nnormal=일반 보고',
          outputFields: [
            { name: 'riskLevel', type: 'string', description: '위험도', enumValues: ['critical', 'high', 'normal'] },
          ],
        },
      ],
    });

    const step = ir.steps?.find((entry) => entry.type === 'ai_decision');
    expect(step && step.type === 'ai_decision' && step.memo).toContain('critical=');
  });

  it('keeps missing decision intent and output contract visible as required slots', () => {
    const ir = buildIRFromWorkflow({
      name: 'PDF',
      goal: '분류',
      triggerType: 'manual',
      assumptions: [],
      nodes: [{ type: 'ai_decision', id: 'classify' }],
    });

    const completeness = assessCompleteness(ir);
    expect(completeness.missingRequired).toContain('classify.goal');
    expect(completeness.missingRequired).toContain('ai_decision.schema');
    expect(ir.steps?.find((step) => step.type === 'ai_decision')?.goal).toBe('');
  });

});

describe('validateCanvasDraftGraph', () => {
  it('flags flat multi-notify graphs without classify/if', () => {
    const issues = validateCanvasDraftGraph({
      name: '알림',
      goal: '등급별 알림',
      assumptions: [],
      nodes: [
        { type: 'action', id: 'a', connector: 'slack', action: 'message.send', params: {} },
        { type: 'action', id: 'b', connector: 'slack', action: 'message.send', params: {} },
      ],
    });

    expect(issues.some((issue) => issue.message.includes('ai_decision'))).toBe(true);
  });

  it('flags notify nodes not wired into if branches', () => {
    const issues = validateCanvasDraftGraph({
      name: '알림',
      goal: '등급별 알림',
      triggerType: 'manual',
      assumptions: [],
      nodes: [
        { type: 'ai_decision', id: 'classify', goal: '분류' },
        {
          type: 'if',
          id: 'if_critical',
          condition: { op: 'eq', left: { ref: 'classify.riskLevel' }, right: { lit: 'critical' } },
          thenStepIds: ['critical_slack'],
        },
        { type: 'action', id: 'critical_slack', actionRef: 'slack.message.send@1' },
        { type: 'action', id: 'high_slack', actionRef: 'slack.message.send@1' },
      ],
      actions: {
        critical_slack: { actionRef: 'slack.message.send@1', params: {} },
        high_slack: { actionRef: 'slack.message.send@1', params: {} },
      },
    });

    expect(issues.some((issue) => issue.message.includes('thenStepIds'))).toBe(true);
  });
});
