import { describe, expect, it } from 'vitest';
import { planToInterviewDraft } from '../../plan/schema.js';
import { createInterviewState } from '../../session/state.js';
import { applyInterviewPatch } from '../../session/patch-turn.js';
import { buildDesignToolContext } from '../../../design-tools/context.js';
import { buildAssistantMessage } from '../../session/messages.js';

const DESIGN_CTX = buildDesignToolContext([], ['slack', 'document']);
const PATCH_OPTIONS = {
  connectedConnectors: ['slack', 'document'],
  designToolContext: DESIGN_CTX,
};

describe('applyInterviewPatch', () => {
  it('fills action params without calling the interview agent', () => {
    const base = createInterviewState('PDF 분류', 'once');
    const draft = planToInterviewDraft(
      {
        name: 'PDF',
        goal: '분류',
        nodes: [
          {
            type: 'action',
            id: 'critical_slack',
            actionRef: 'slack.message.send@1',
            params: {},
          },
        ],
      },
      {},
      'PDF 분류',
    );

    const state = {
      ...base,
      workflow: draft,
      partialPlan: {
        name: 'PDF',
        goal: '분류',
        nodes: draft.nodes,
      },
    };

    const next = applyInterviewPatch(
      state,
      { set: { 'critical_slack.params.channel': '#ops', triggerType: 'manual' } },
      PATCH_OPTIONS,
    );

    expect(next.workflow.triggerType).toBe('manual');
    expect(next.workflow.actions?.critical_slack?.params?.channel).toBe('#ops');
    expect(next.completeness.missingRequired).not.toContain('critical_slack.params.channel');
  });

  it('ignores non-enum triggerType patch values', () => {
    const base = createInterviewState('PDF 분류', 'once');
    const draft = planToInterviewDraft(
      {
        name: 'PDF',
        goal: '분류',
        nodes: [],
      },
      {},
      'PDF 분류',
    );

    const next = applyInterviewPatch(
      { ...base, workflow: draft },
      { set: { triggerType: '지금 한번' } },
      PATCH_OPTIONS,
    );

    expect(next.workflow.triggerType).toBeUndefined();
  });
});

describe('buildAssistantMessage', () => {
  it('shows the AI interview question when values are missing', () => {
    const completeness = {
      slots: [
        { slot: 'a.params.channel', filled: false, label: 'Slack', question: 'Slack 채널은?' },
      ],
      missingRequired: ['a.params.channel'],
      deployable: false,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('Slack 채널을 알려주세요.', completeness, false, 'once');

    expect(text).toBe('Slack 채널을 알려주세요.');
  });

  it('mentions missing connections in panel guidance', () => {
    const text = buildAssistantMessage('', {
      slots: [],
      missingRequired: [],
      deployable: false,
      missingConnections: ['slack'],
      contractIssues: [],
    }, false, 'once');

    expect(text).toContain('Slack');
    expect(text).toContain('설정');
  });
});
