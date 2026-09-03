import { describe, expect, it } from 'vitest';
import {
  connectionGuidance,
  panelFieldsForSource,
} from './panel-fields.js';
import type { WorkflowCanvasDraft } from '../draft/schema.js';
import type { CompletenessResult } from '../slots/types.js';

const completeness = (slots: CompletenessResult['slots'] = []): CompletenessResult => ({
  slots,
  missingRequired: [],
  deployable: true,
  missingConnections: [],
});

const baseDraft = (nodes: WorkflowCanvasDraft['nodes'] = []): WorkflowCanvasDraft => ({
  name: '테스트 업무',
  goal: '테스트',
  assumptions: [],
  nodes,
  actions: {},
});

describe('panel-fields', () => {
  it('renders the selected trigger as a panel field', () => {
    const draft = { ...baseDraft(), triggerType: 'manual' as const };

    expect(panelFieldsForSource(draft, '__trigger__', completeness())).toEqual([
      { slot: 'triggerType', label: '시작 방식', value: '수동', required: false },
    ]);
  });

  it('renders required action parameters from the resolved capability', () => {
    const node = { type: 'action' as const, id: 'notify', actionRef: 'slack.message.send@1' };
    const draft = {
      ...baseDraft([node]),
      actions: {
        notify: {
          actionRef: 'slack.message.send@1',
          params: { channel: '#ops', text: '완료 알림' },
        },
      },
    };

    expect(panelFieldsForSource(draft, 'notify', completeness())).toMatchObject([
      { slot: 'notify.params.channel', label: 'Slack 채널', value: '#ops', required: true },
      { slot: 'notify.params.text', label: '메시지', value: '완료 알림', required: true },
    ]);
  });

  it('renders the AI decision memo field', () => {
    const draft = baseDraft([
      { type: 'ai_decision', id: 'classify', memo: '결제 완료 여부를 판단' },
    ]);

    expect(panelFieldsForSource(draft, 'classify', completeness())).toEqual([
      {
        slot: 'classify.memo',
        label: '판단 기준',
        hint: '이 단계에서 어떻게 나눌지 적어 주세요.',
        value: '결제 완료 여부를 판단',
        required: false,
      },
    ]);
  });

  it('returns connector guidance only when connections are missing', () => {
    expect(connectionGuidance(undefined)).toBeNull();
    expect(connectionGuidance(['slack', 'gmail'])).toEqual({
      connectors: ['slack', 'gmail'],
      message: 'Slack, Gmail 연결이 필요합니다. 설정에서 연결해 주세요.',
    });
  });
});
