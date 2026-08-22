import { describe, expect, it } from 'vitest';
import { branchHintsFromWorkflow } from '../../slots/branch-hints.js';
import { nodeSlotQuestion } from '../../slots/ids.js';
import { assessCompleteness } from '../../slots/requiredness.js';
import type { WorkflowIR } from '../../../workflow/schema.js';

describe('branchHintsFromWorkflow', () => {
  const base: Partial<WorkflowIR> = {
    goal: 'PDF 위험도 알림',
    success: '완료',
    trigger: { type: 'manual' },
    steps: [
      {
        type: 'ai_decision',
        id: 'classify',
        goal: '위험도 분류',
        outputSchema: {
          type: 'object',
          properties: {
            riskLevel: { type: 'string', enum: ['critical', 'high', 'normal'] },
          },
          required: ['riskLevel'],
        },
      },
      {
        type: 'if',
        id: 'if_critical',
        condition: { op: 'eq', left: { ref: 'classify.riskLevel' }, right: { lit: 'critical' } },
        thenStepIds: ['notify_slack', 'notify_mail'],
        elseStepIds: ['if_high'],
      },
      {
        type: 'if',
        id: 'if_high',
        condition: { op: 'eq', left: { ref: 'classify.riskLevel' }, right: { lit: 'high' } },
        thenStepIds: ['notify_slack_2', 'notify_mail_2'],
        elseStepIds: ['notify_slack_3'],
      },
      {
        type: 'action',
        id: 'notify_slack',
        connector: 'slack',
        action: 'message.send',
        params: {},
        sideEffect: 'EXTERNAL',
      },
      {
        type: 'action',
        id: 'notify_mail',
        connector: 'gmail',
        action: 'message.send',
        params: { subject: '알림' },
        sideEffect: 'EXTERNAL_HIGH',
      },
      {
        type: 'action',
        id: 'notify_slack_2',
        connector: 'slack',
        action: 'message.send',
        params: {},
        sideEffect: 'EXTERNAL',
      },
      {
        type: 'action',
        id: 'notify_mail_2',
        connector: 'gmail',
        action: 'message.send',
        params: { subject: '알림' },
        sideEffect: 'EXTERNAL_HIGH',
      },
      {
        type: 'action',
        id: 'notify_slack_3',
        connector: 'slack',
        action: 'message.send',
        params: {},
        sideEffect: 'EXTERNAL',
      },
    ],
  };

  it('derives branch labels from if wiring even when node ids are generic', () => {
    const hints = branchHintsFromWorkflow(base);
    expect(hints.get('notify_slack')).toBe('긴급(critical)');
    expect(hints.get('notify_mail')).toBe('긴급(critical)');
    expect(hints.get('notify_slack_2')).toBe('운영(high)');
    expect(hints.get('notify_slack_3')).toBe('보고(normal)');
  });

  it('asks disambiguated slack questions for generic notify node ids', () => {
    const completeness = assessCompleteness(base, ['slack', 'gmail']);
    const criticalQuestion = completeness.slots.find((slot) => slot.slot === 'notify_slack.params.channel')?.question;
    const highQuestion = completeness.slots.find((slot) => slot.slot === 'notify_slack_2.params.channel')?.question;

    expect(criticalQuestion).toBe('긴급(critical) 알림을 보낼 Slack 채널은 어디인가요?');
    expect(highQuestion).toBe('운영(high) 알림을 보낼 Slack 채널은 어디인가요?');
    expect(nodeSlotQuestion('notify_slack', 'Slack 채널은 어디인가요?', '긴급(critical)')).toBe(
      criticalQuestion,
    );
  });
});
