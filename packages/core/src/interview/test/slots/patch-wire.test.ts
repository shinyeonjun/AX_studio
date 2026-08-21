import { describe, expect, it } from 'vitest';
import { applySlotValuesToDraft, mergePatch } from '../../slots/patch.js';
import { planToInterviewDraft } from '../../plan/schema.js';
import { expandInterviewWireEnvelope } from '../../agent/wire-schema.js';
import { parseInterviewProviderOutput } from '../../agent/output-schema.js';

describe('interview-patch', () => {
  it('merges slot values into action params', () => {
    const draft = planToInterviewDraft(
      {
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
      },
      {},
      '알림',
    );

    const merged = applySlotValuesToDraft(draft, mergePatch({}, { set: { 'notify.params.channel': '#ops' } }));
    expect(merged.actions.notify?.params).toEqual({ channel: '#ops' });
  });
});

describe('interview wire envelope', () => {
  it('expands Codex patch envelope into native patch output', () => {
    const expanded = expandInterviewWireEnvelope({
      kind: 'patch',
      payload: '{"set":{"notify.params.channel":"#ax테스트"}}',
      toolCalls: '',
      nextQuestion: '반영했습니다.',
    });
    const parsed = parseInterviewProviderOutput('codex-cli', expanded);
    expect(parsed.kind).toBe('patch');
    if (parsed.kind !== 'patch') return;
    expect(parsed.patch.set['notify.params.channel']).toBe('#ax테스트');
    expect(parsed.nextQuestion).toBe('반영했습니다.');
  });

  it('expands Codex plan envelope', () => {
    const expanded = expandInterviewWireEnvelope({
      kind: 'plan',
      payload: JSON.stringify({
        name: 'PDF Slack',
        goal: '요약 후 Slack',
        triggerType: 'manual',
        nodes: [{ type: 'action', id: 'notify', actionRef: 'slack.message.send@1', params: {} }],
      }),
      toolCalls: '',
      nextQuestion: '채널을 알려주세요.',
    });
    const parsed = parseInterviewProviderOutput('codex-cli', expanded);
    expect(parsed.kind).toBe('plan');
    if (parsed.kind !== 'plan') return;
    expect(parsed.plan.nodes).toHaveLength(1);
  });
});
