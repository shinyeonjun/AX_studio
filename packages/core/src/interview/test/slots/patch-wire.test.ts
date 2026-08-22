import { describe, expect, it } from 'vitest';
import { applySlotValuesToDraft } from '../../slots/patch.js';
import { InterviewDraftSchema } from '../../draft/schema.js';
import {
  AgenticInterviewWireEnvelopeSchema,
  expandAgenticInterviewWireEnvelope,
  parseAgenticInterviewOutput,
} from '../../agent/agent-schema.js';

describe('interview-patch', () => {
  it('merges slot values into action params', () => {
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

    const merged = applySlotValuesToDraft(draft, { 'notify.params.channel': '#ops' });
    expect(merged.actions.notify?.params).toEqual({ channel: '#ops' });
  });
});

describe('agentic interview wire envelope', () => {
  it('expands a Codex or Claude patch envelope into the typed patch output', () => {
    const expanded = expandAgenticInterviewWireEnvelope({
      kind: 'patch',
      payload: JSON.stringify({
        baseRevision: 0,
        set: { 'notify.params.channel': '#ax테스트' },
        upsertNodes: [],
        removeNodeIds: [],
        message: '반영했습니다.',
      }),
      toolCalls: '',
      message: '반영했습니다.',
    });

    expect(expanded.kind).toBe('patch');
    if (expanded.kind !== 'patch') return;
    expect(expanded.patch.set['notify.params.channel']).toBe('#ax테스트');
    expect(expanded.message).toBe('반영했습니다.');
  });

  it('expands a tool envelope and keeps its calls bounded by the shared tool schema', () => {
    const envelope = AgenticInterviewWireEnvelopeSchema.parse({
      kind: 'tools',
      payload: '',
      toolCalls: JSON.stringify([{ tool: 'connections.list', args: {} }]),
      message: '',
    });
    const expanded = expandAgenticInterviewWireEnvelope(envelope);
    expect(expanded).toEqual({ kind: 'tools', toolCalls: [{ tool: 'connections.list', args: {} }] });
  });

  it('rejects the removed plan/replan output protocol', () => {
    expect(() => parseAgenticInterviewOutput('scripted', {
      kind: 'plan',
      name: 'Slack 알림',
      goal: '알림',
      nodes: [],
    })).toThrow();
  });
});
