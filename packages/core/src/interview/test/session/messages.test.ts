import { describe, expect, it } from 'vitest';
import { buildAssistantMessage, isRunConfirmationMessage, shouldFinalizeInterview } from '../../session/messages.js';
import type { CompletenessResult } from '../../slots/types.js';

describe('buildAssistantMessage', () => {
  it('does not ask non-blocking param slots in chat when the graph is already visible', () => {
    const completeness: CompletenessResult = {
      slots: [
        { slot: 'trigger', filled: true, label: '시작', question: '언제 실행할까요?' },
        { slot: 'a.params.channel', filled: false, label: 'Slack', question: 'Slack 채널은?' },
      ],
      missingRequired: ['a.params.channel'],
      deployable: false,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('critical일 때 알릴 Slack 채널을 알려주세요.', completeness, false, 'once');

    expect(text).toBe('오른쪽 그래프에서 빈 칸을 확인한 뒤 검토해 주세요.');
  });

  it('asks trigger questions in chat for recurring scope when trigger is blocking', () => {
    const completeness: CompletenessResult = {
      slots: [{ slot: 'trigger', filled: false, label: '시작', question: '언제 실행할까요?' }],
      missingRequired: ['trigger'],
      deployable: false,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('지금 바로 할까요, 아니면 날짜를 정할까요?', completeness, false, 'recurring');

    expect(text).toBe('언제 실행할까요?');
    expect(text).not.toContain('시작 노드');
  });

  it('ignores declarative completion text while required slots are missing', () => {
    const completeness: CompletenessResult = {
      slots: [
        {
          slot: 'critical_slack.params.channel',
          filled: false,
          label: 'Slack',
          question: '긴급(critical) 알림을 보낼 Slack 채널은 어디인가요?',
        },
      ],
      missingRequired: ['critical_slack.params.channel'],
      deployable: false,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage(
      '이제 PDF 1개를 분류해 해당 등급의 알림 흐름으로 넘길 수 있습니다.',
      completeness,
      false,
      'once',
    );

    expect(text).toBe('오른쪽 그래프에서 빈 칸을 확인한 뒤 검토해 주세요.');
    expect(text).not.toContain('critical_slack');
    expect(text).not.toContain('넘길 수 있습니다');
  });

  it('uses the code-owned contract question when contract issues exist', () => {
    const completeness: CompletenessResult = {
      slots: [
        { slot: 'contract.workflow', filled: false, label: '데이터 연결', question: '분석 결과 연결을 확인해 주세요.' },
      ],
      missingRequired: [],
      deployable: false,
      missingConnections: [],
      contractIssues: [{ code: 'missing_input_contract', message: '분석 결과 연결이 없습니다.' }],
    };

    expect(buildAssistantMessage('언제 실행할까요?', completeness, false, 'once')).toBe(
      '분석 결과 연결을 확인해 주세요.',
    );
  });

  it('uses the ready message when deployable, ignoring the model acknowledgement', () => {
    const completeness: CompletenessResult = {
      slots: [],
      missingRequired: [],
      deployable: true,
      missingConnections: [],
      contractIssues: [],
    };

    const text = buildAssistantMessage('Slack 채널을 알려주세요?', completeness, true, 'once');

    expect(text).toBe('업무 워크플로우를 이렇게 이해했습니다. 아래에서 실행하거나 저장할 수 있습니다.');
    expect(isRunConfirmationMessage(text)).toBe(true);
  });
});

describe('interview completion', () => {
  it('finalizes from deployable alone', () => {
    expect(shouldFinalizeInterview(true)).toBe(true);
    expect(shouldFinalizeInterview(false)).toBe(false);
  });
});
