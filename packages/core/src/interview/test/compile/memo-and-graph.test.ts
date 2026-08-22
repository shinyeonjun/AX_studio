import { describe, expect, it } from 'vitest';
import { buildIRFromWorkflow } from '../../compile/builder.js';
import { validateInterviewDraftGraph } from '../../compile/validate-graph.js';
import { applySlotValuesToDraft } from '../../slots/patch.js';
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

  it('applies classify.memo via patch slot', () => {
    const next = applySlotValuesToDraft(
      {
        name: 'PDF',
        goal: '분류',
        assumptions: [],
        actions: {},
        nodes: [{ type: 'ai_decision', id: 'classify', goal: '분류' }],
      },
      { 'classify.memo': 'critical=긴급\nnormal=보고' },
    );

    expect(next.nodes[0]?.type === 'ai_decision' && next.nodes[0].memo).toContain('critical=');
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

  it('patches node intent fields without changing the graph', () => {
    const next = applySlotValuesToDraft(
      {
        name: '승인',
        goal: '승인',
        assumptions: [],
        actions: {},
        nodes: [
          { type: 'ai_decision', id: 'classify' },
          { type: 'human_approval', id: 'approve', forActionIds: ['send'] },
        ],
      },
      {
        'classify.goal': '위험도 분류',
        'approve.reason': '외부 메일 발송 승인',
      },
    );

    expect(next.nodes).toMatchObject([
      { id: 'classify', goal: '위험도 분류' },
      { id: 'approve', reason: '외부 메일 발송 승인' },
    ]);
  });
});

describe('validateInterviewDraftGraph', () => {
  it('flags flat multi-notify graphs without classify/if', () => {
    const issues = validateInterviewDraftGraph({
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
    const issues = validateInterviewDraftGraph({
      name: '알림',
      goal: '등급별 알림',
      triggerType: 'manual',
      assumptions: [],
      nodes: [
        { type: 'ai_decision', id: 'classify', goal: '분류' },
        { type: 'if', id: 'if_critical', condition: 'classify.riskLevel == critical', thenStepIds: ['critical_slack'] },
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
