import { describe, expect, it } from 'vitest';
import { buildIRFromWorkflow } from '../../compile/builder.js';
import { assessCompleteness } from '../../slots/requiredness.js';
import { applyAnswer, startInterview } from '../../session/flow.js';
import { createAgentHarness } from '../../../agent/harness.js';
import { buildDesignToolContext } from '../../../design-tools/context.js';
import type { InterviewTurn } from '../../draft/schema.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../../agent/model/provider.js';

class ScriptedModelProvider implements ModelProvider {
  readonly name = 'scripted';
  private index = 0;

  constructor(private turns: InterviewTurn[]) {}

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const turn = this.turns[Math.min(this.index, this.turns.length - 1)];
    this.index += 1;
    const { nextQuestion, ...plan } = turn;
    return input.schema.parse({ kind: 'plan', plan, nextQuestion, payload: '', toolCalls: '' });
  }

  async generateText(_input: TextGenerateInput): Promise<string> {
    return '';
  }
}

describe('gmail slack interview finalize', () => {
  it('marks naver gmail slack workflow deployable', () => {
    const ir = buildIRFromWorkflow({
      name: '네이버 메일 Slack 알림',
      goal: '네이버 메일 요약 Slack',
      triggerType: 'gmail.new_message',
      gmailAccount: 'primary',
      triggerFilter: { op: 'contains', left: { ref: 'from' }, right: { lit: 'naver.com' } },
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'read-mail',
          connector: 'gmail',
          action: 'messages.read',
          params: { messageId: '{{messageId}}' },
        },
        {
          type: 'ai_decision',
          id: 'summarize',
          goal: '핵심 요약',
          outputFields: [{ name: 'summary', type: 'string', description: '메일 요약' }],
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax테스트', text: '{{summarize.summary}}' },
        },
      ],
      success: 'Slack 알림 완료',
    });
    const completeness = assessCompleteness(ir, ['gmail', 'slack', 'document']);
    expect(completeness.deployable).toBe(true);
  });

  it('finalizes after channel answer with review confirmation', async () => {
    const turns: InterviewTurn[] = [
      {
        name: '네이버 메일 Slack 알림',
        goal: '네이버 메일 요약 Slack',
        triggerType: 'gmail.new_message',
        gmailAccount: 'primary',
        assumptions: [],
        nodes: [
          {
            type: 'action',
            id: 'read-mail',
            connector: 'gmail',
            action: 'messages.read',
            params: { messageId: '{{messageId}}' },
          },
          {
            type: 'ai_decision',
            id: 'summarize',
            goal: '핵심 요약',
            outputFields: [{ name: 'summary', type: 'string', description: '메일 요약' }],
          },
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { text: '{{summarize.summary}}' },
          },
        ],
        success: 'Slack 알림 완료',
        nextQuestion: '요약 내용을 어느 Slack 채널에 보낼까요?',
      },
      {
        name: '네이버 메일 Slack 알림',
        goal: '네이버 메일 요약 Slack',
        triggerType: 'gmail.new_message',
        gmailAccount: 'primary',
        assumptions: [],
        nodes: [
          {
            type: 'action',
            id: 'read-mail',
            connector: 'gmail',
            action: 'messages.read',
            params: { messageId: '{{messageId}}' },
          },
          {
            type: 'ai_decision',
            id: 'summarize',
            goal: '핵심 요약',
            outputFields: [{ name: 'summary', type: 'string', description: '메일 요약' }],
          },
          {
            type: 'action',
            id: 'notify',
            connector: 'slack',
            action: 'message.send',
            params: { channel: '#ax테스트', text: '{{summarize.summary}}' },
          },
        ],
        success: 'Slack 알림 완료',
        nextQuestion: '업무 흐름을 이렇게 이해했습니다. 아래에서 실행하거나 저장할 수 있습니다.',
      },
    ];

    const harness = createAgentHarness(new ScriptedModelProvider(turns));
    const options = {
      harness,
      connectedConnectors: ['gmail', 'slack', 'document'],
      designToolContext: buildDesignToolContext([], ['gmail', 'slack', 'document']),
    };

    const first = await startInterview('네이버 메일 오면 slack으로', options, 'recurring');
    expect(first.done).toBe(false);

    const second = await applyAnswer(first, '#ax테스트 여기', options);
    expect(second.completeness?.deployable).toBe(true);
    expect(second.done).toBe(true);
  });

  it('does not invent a gmail account or completion condition', async () => {
    const turn: InterviewTurn = {
      name: '네이버 메일 Slack 알림',
      goal: '네이버 메일 요약 Slack',
      triggerType: 'gmail.new_message',
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'read-mail',
          connector: 'gmail',
          action: 'messages.read',
          params: { messageId: '{{messageId}}' },
        },
        {
          type: 'ai_decision',
          id: 'summarize',
          goal: '핵심 요약',
          outputFields: [{ name: 'summary', type: 'string', description: '메일 요약' }],
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax테스트', text: '{{summarize.summary}}' },
        },
      ],
      nextQuestion: '업무 흐름을 이렇게 이해했습니다. 아래에서 실행하거나 저장할 수 있습니다.',
    };

    const harness = createAgentHarness(new ScriptedModelProvider([turn]));
    const state = await startInterview('네이버 메일 slack', {
      harness,
      connectedConnectors: ['gmail', 'slack', 'document'],
      designToolContext: buildDesignToolContext([], ['gmail', 'slack', 'document']),
    }, 'recurring');

    expect(state.completeness?.deployable).toBe(false);
    expect(state.done).toBe(false);
    expect(state.completeness?.missingRequired).toEqual(
      expect.arrayContaining(['gmail.new_message.accountId', 'completion']),
    );
  });

  it('points missing workflow fields to chat interview instead of the review footer', async () => {
    const turn: InterviewTurn = {
      name: 'PDF 정리 후 Slack 전송',
      goal: 'PDF를 읽고 Slack으로 보낸다',
      triggerType: 'manual',
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: {},
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax테스트', text: '요약' },
        },
      ],
      nextQuestion: '설계를 검토한 뒤 AX Studio에서 저장하면 실행할 수 있습니다.',
    };

    const harness = createAgentHarness(new ScriptedModelProvider([turn]));
    const state = await startInterview('연결된 폴더 PDF를 Slack으로 보내줘', {
      harness,
      connectedConnectors: ['slack', 'document'],
      designToolContext: buildDesignToolContext([], ['slack', 'document']),
    }, 'once');

    expect(state.done).toBe(false);
    expect(state.messages.at(-1)?.content).toContain('문서');
    expect(state.messages.at(-1)?.content).not.toContain('설계를 검토한 뒤');
  });
});
