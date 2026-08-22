import { describe, expect, it } from 'vitest';
import { InterviewDraftSchema } from '../../draft/schema.js';
import { applySlotValuesToDraft } from '../../slots/patch.js';
import { isActionParamFilled } from '../../slots/filled.js';
import { nodeParamSlotId, parseNodeParamSlot } from '../../slots/ids.js';
import { ensureRequiredParamKeysOnDraft, seedDefaultSuccessCondition, seedNodeIntentFromWorkflowGoal } from '../../slots/seed.js';
import { assessCompleteness } from '../../slots/requiredness.js';

describe('interview-slots', () => {
  it('builds node param slot ids', () => {
    expect(nodeParamSlotId('critical_slack', 'channel')).toBe('critical_slack.params.channel');
    expect(parseNodeParamSlot('critical_slack.params.channel')).toEqual({
      nodeId: 'critical_slack',
      paramName: 'channel',
    });
  });

  it('treats refs and non-empty strings as filled', () => {
    expect(isActionParamFilled('')).toBe(false);
    expect(isActionParamFilled('#ops')).toBe(true);
    expect(isActionParamFilled({ ref: 'classify.message' })).toBe(true);
    expect(isActionParamFilled('{{filePath}}')).toBe(true);
  });

  it('tracks separate required slots per action node', () => {
    const missing = assessCompleteness(
      {
        goal: '위험도별 Slack',
        success: '완료',
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'action',
            id: 'critical_slack',
            connector: 'slack',
            action: 'message.send',
            params: {},
            sideEffect: 'EXTERNAL',
          },
          {
            type: 'action',
            id: 'high_slack',
            connector: 'slack',
            action: 'message.send',
            params: {},
            sideEffect: 'EXTERNAL',
          },
        ],
      },
      ['slack'],
    );

    expect(missing.missingRequired).toContain('critical_slack.params.channel');
    expect(missing.missingRequired).toContain('high_slack.params.channel');
    const criticalQuestion = missing.slots.find((slot) => slot.slot === 'critical_slack.params.channel')?.question;
    expect(criticalQuestion).toBe('긴급(critical) 알림을 보낼 Slack 채널은 어디인가요?');
    expect(criticalQuestion).not.toContain('critical_slack');
  });

  it('patches node slots independently', () => {
    const draft = InterviewDraftSchema.parse({
        name: 'Slack 분기',
        goal: '위험도별 Slack',
        triggerType: 'manual',
        nodes: [
          {
            type: 'action',
            id: 'critical_slack',
            actionRef: 'slack.message.send@1',
            params: {},
          },
          {
            type: 'action',
            id: 'high_slack',
            actionRef: 'slack.message.send@1',
            params: {},
          },
        ],
      });

    const patched = applySlotValuesToDraft(draft, {
      'critical_slack.params.channel': '#ax테스트',
      'high_slack.params.channel': '#ax테스트2',
    });

    expect(patched.actions.critical_slack?.params).toEqual({
      channel: '#ax테스트',
    });
    expect(patched.actions.high_slack?.params).toEqual({
      channel: '#ax테스트2',
    });
  });

  it('seeds empty required params from catalog', () => {
    const draft = InterviewDraftSchema.parse({
        name: 'Slack',
        goal: '알림',
        triggerType: 'manual',
        nodes: [
          {
            type: 'action',
            id: 'notify',
            actionRef: 'slack.message.send@1',
            params: {},
          },
        ],
      });

    const seeded = ensureRequiredParamKeysOnDraft(draft);
    expect(seeded.actions.notify?.params).toEqual({ channel: '', text: '' });
  });

  it('does not inject empty path when document ingest already has file ref', () => {
    const draft = InterviewDraftSchema.parse({
        name: 'PDF',
        goal: 'PDF 분류',
        triggerType: 'manual',
        nodes: [
          {
            type: 'action',
            id: 'ingest_pdf',
            actionRef: 'document.ingest@1',
            params: {
              file: { path: 'D:\\inbox\\report.pdf', name: 'report.pdf', folderId: 'folder-1' },
            },
          },
        ],
      });

    const seeded = ensureRequiredParamKeysOnDraft(draft);
    expect(seeded.actions.ingest_pdf?.params).toEqual({
      file: { path: 'D:\\inbox\\report.pdf', name: 'report.pdf', folderId: 'folder-1' },
    });
    expect(seeded.actions.ingest_pdf?.params?.path).toBeUndefined();
  });

  it('seeds default success without asking completion in chat', () => {
    const draft = InterviewDraftSchema.parse({
        name: 'PDF 알림',
        goal: 'PDF 위험도 알림',
        triggerType: 'manual',
        nodes: [
          { type: 'action', id: 'critical_slack', actionRef: 'slack.message.send@1', params: {} },
        ],
      });

    const seeded = seedDefaultSuccessCondition(draft);
    expect(seeded.success).toBe('모든 알림 단계가 실행되면 완료');
  });

  it('seeds ai_decision goal from workflow goal', () => {
    const draft = InterviewDraftSchema.parse({
        name: 'PDF 위험도',
        goal: 'PDF 위험도를 critical/high/normal로 분류',
        triggerType: 'manual',
        nodes: [
          {
            type: 'ai_decision',
            id: 'classify_risk',
            goal: '',
            outputFields: [{ name: 'riskLevel', type: 'string', description: '위험도', enumValues: ['critical', 'high', 'normal'] }],
          },
        ],
      });

    const seeded = seedNodeIntentFromWorkflowGoal(draft);
    expect(seeded.nodes[0]).toMatchObject({
      goal: 'PDF 위험도를 critical/high/normal로 분류',
      memo: 'critical, high, normal 중 하나로 분류합니다.',
    });
  });

  it('does not require bound text params', () => {
    const result = assessCompleteness(
      {
        goal: '알림',
        success: '완료',
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'ai_decision',
            id: 'classify',
            goal: '위험도 분류',
            outputSchema: {
              type: 'object',
              properties: { summary: { type: 'string', description: '요약' } },
              required: ['summary'],
            },
          },
          {
            type: 'action',
            id: 'critical_slack',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#ax테스트' },
            bindings: { text: { from: 'classify', output: 'summary' } },
            sideEffect: 'EXTERNAL',
          },
        ],
      },
      ['slack'],
    );

    expect(result.missingRequired).not.toContain('critical_slack.params.text');
  });

  it('requires gmail send body before deployable', () => {
    const result = assessCompleteness(
      {
        goal: '테스트 메일',
        success: '완료',
        trigger: { type: 'manual' },
        steps: [
          {
            type: 'action',
            id: 'send_mail',
            connector: 'gmail',
            action: 'message.send',
            params: { to: 'plosind@naver.com', subject: '테스트' },
            sideEffect: 'EXTERNAL_HIGH',
          },
        ],
      },
      ['gmail'],
    );

    expect(result.deployable).toBe(false);
    expect(result.missingRequired).toContain('send_mail.params.body');
  });
});
