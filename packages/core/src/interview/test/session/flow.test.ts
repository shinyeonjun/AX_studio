import { describe, expect, it } from 'vitest';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../../agent/model/provider.js';
import { chatMessagesFromInput, flattenChatPrompt, normalizeChatMessages } from '../../../agent/model/chat.js';
import { composedPrompt } from '../../../agent/model/cli/shared.js';
import { createAgentHarness } from '../../../agent/harness.js';
import { applyAnswer, startInterview } from '../../session/flow.js';
import { applyInterviewPatch } from '../../session/patch-turn.js';
import { buildIRFromWorkflow } from '../../compile/builder.js';
import { assessCompleteness } from '../../slots/requiredness.js';
import type { InterviewTurn } from '../../draft/schema.js';
import { loadAgentSkill } from '../../../agent/skill-load.js';
import { buildDesignToolContext } from '../../../design-tools/context.js';

class ScriptedModelProvider implements ModelProvider {
  readonly name = 'scripted';
  readonly calls: StructuredGenerateInput<unknown>[] = [];
  private index = 0;

  constructor(private turns: InterviewTurn[]) {}

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls.push(input as StructuredGenerateInput<unknown>);
    const turn = this.turns[Math.min(this.index, this.turns.length - 1)];
    this.index += 1;
    const { nextQuestion, ...plan } = turn;
    return input.schema.parse({
      kind: 'plan',
      plan,
      nextQuestion,
      payload: '',
      toolCalls: '',
    });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

const CONNECTED = ['gmail', 'slack', 'local_sheet', 'rdb', 'document'];
const DESIGN_CTX = buildDesignToolContext([], CONNECTED);

const interviewOptions = (harness: ReturnType<typeof createAgentHarness>) => ({
  harness,
  connectedConnectors: CONNECTED,
  designToolContext: DESIGN_CTX,
});

const incompleteSend: InterviewTurn = {
  name: '테스트 메일',
  goal: '테스트 메일을 보낸다',
  triggerType: 'once',
  runAt: '2026-08-19T10:00:00.000Z',
  assumptions: [],
  nodes: [
    {
      type: 'action',
      id: 'send_mail',
      connector: 'gmail',
      action: 'send',
      params: { subject: '테스트', body: '테스트 메일입니다.' },
    },
  ],
  nextQuestion: '메일을 누구에게 보낼까요?',
};

const completeSend: InterviewTurn = {
  ...incompleteSend,
  nodes: [
    {
      type: 'action',
      id: 'send_mail',
      connector: 'gmail',
      action: 'message.send',
      params: {
        to: 'test@example.com',
        subject: '테스트',
        body: '테스트 메일입니다.',
      },
    },
  ],
  nextQuestion: '1분 뒤 메일 발송 워크플로우로 이해했습니다.',
  assumptions: ['제목과 본문은 테스트 기본값'],
  success: '메일 발송 완료',
};

describe('agent interview skill', () => {
  it('loads SKILL.md from disk', () => {
    const skill = loadAgentSkill('interview');
    expect(skill.name).toBe('interview');
    expect(skill.body).toContain('{{workflow_state}}');
    expect(skill.body).toContain('{{design_tools}}');
    expect(skill.body).toContain('{{capability_catalog}}');
  });

  it('prepends AGENTS.md constitution via harness system prompt', async () => {
    const model = new ScriptedModelProvider([incompleteSend]);
    const harness = createAgentHarness(model);
    const first = await startInterview('안녕', interviewOptions(harness), 'once');
    expect(first.messages).toHaveLength(2);
    expect(model.calls[0]?.system).toContain('AX Studio Agent 헌법');
    expect(model.calls[0]?.system).toContain('현재 workflow');
    expect(model.calls[0]?.system).not.toContain('{{workflow_state}}');
  });
});

describe('chat session helpers', () => {
  it('sends native messages for API-style input and flattens for CLI', () => {
    const messages = chatMessagesFromInput({
      system: 'sys',
      messages: [
        { role: 'user', content: '메일 보내줘' },
        { role: 'assistant', content: '누구에게요?' },
        { role: 'user', content: '홍길동' },
      ],
    });
    expect(messages).toHaveLength(3);
    expect(flattenChatPrompt('sys', messages)).toContain('Assistant: 누구에게요?');
  });

  it('resume prompt keeps system + last user and drops prior turns', () => {
    const resume = composedPrompt(
      {
        system: 'sys',
        messages: [
          { role: 'user', content: '메일 보내줘' },
          { role: 'assistant', content: '누구에게요?' },
          { role: 'user', content: '홍길동' },
        ],
      },
      { resume: true },
    );
    expect(resume).toContain('sys');
    expect(resume).toContain('홍길동');
    expect(resume).not.toContain('누구에게요?');
  });

  it('merges consecutive same-role messages', () => {
    const merged = normalizeChatMessages([
      { role: 'user', content: '하나' },
      { role: 'user', content: '둘' },
    ]);
    expect(merged).toEqual([{ role: 'user', content: '하나\n\n둘' }]);
  });
});

describe('workflow builder', () => {
  it('persists the discovered local folder identity and path in the trigger contract', () => {
    const ir = buildIRFromWorkflow({
      name: '폴더 PDF',
      goal: 'PDF 요약',
      triggerType: 'local_folder.new_file',
      localFolderId: 'folder-1',
      localFolderPath: 'D:\\AX\\incoming',
      localFolderExtensions: '.pdf',
      assumptions: [],
      nodes: [],
    });

    expect(ir.trigger).toMatchObject({
      type: 'local_folder.new_file',
      folderId: 'folder-1',
      folderPath: 'D:\\AX\\incoming',
    });
    expect(ir.inputs).toContain('folderPath');
  });

  it('resolves gmail send alias and leaves missing AI output schema explicit', () => {
    const ir = buildIRFromWorkflow({
      name: '메일',
      goal: '보내기',
      triggerType: 'once',
      runAt: '2026-08-19T10:00:00.000Z',
      assumptions: [],
      nodes: [
        { type: 'action', id: 'send_mail', connector: 'gmail', action: 'send', params: { to: 'a@b.com' } },
        { type: 'ai_decision', id: 'decide', goal: '판단' },
      ],
    });
    expect(ir.trigger?.type).toBe('once');
    expect(ir.steps?.some((s) => s.type === 'human_approval')).toBe(true);
    const send = ir.steps?.find((s) => s.type === 'action' && s.action === 'message.send');
    expect(send).toMatchObject({ connector: 'gmail', sideEffect: 'EXTERNAL_HIGH' });
    const decision = ir.steps?.find((s) => s.type === 'ai_decision');
    expect(decision && decision.type === 'ai_decision' && decision.outputSchema).toBeUndefined();
    expect(ir.document).toContain('# 메일');
    expect(ir.document).toContain('gmail.message.send');
  });

  it('declares a file input contract for one-time document workflows', () => {
    const ir = buildIRFromWorkflow({
      name: 'PDF 처리',
      goal: '연결된 폴더의 PDF 처리',
      triggerType: 'manual',
      assumptions: [],
      nodes: [
        { type: 'action', id: 'ingest', connector: 'document', action: 'ingest', params: {} },
      ],
    });

    expect(ir.inputs).toContain('filePath');
    expect(assessCompleteness(ir, ['document']).contractIssues).toEqual([]);
  });

  it('builds action nodes from a canonical actionRef without connector/action duplication', () => {
    const ir = buildIRFromWorkflow({
      name: 'Slack 알림',
      goal: 'Slack으로 알림',
      triggerType: 'manual',
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'notify',
          actionRef: 'slack.message.send@1',
          params: { channel: '#test', text: 'hello' },
        },
      ],
    });

    expect(ir.steps?.find((step) => step.type === 'action')).toMatchObject({
      connector: 'slack',
      action: 'message.send',
      actionRef: 'slack.message.send@1',
    });
  });

  it('hard-rejects unknown capabilities', () => {
    expect(() =>
      buildIRFromWorkflow({
        name: '잘못된 워크플로우',
        goal: '없는 도구',
        triggerType: 'manual',
        assumptions: [],
        nodes: [
          { type: 'action', id: 'boom', connector: 'salesforce', action: 'customer.destroy', params: {} },
        ],
      }),
    ).toThrow(/salesforce\.customer\.destroy/);
  });

  it('skips action nodes that have not chosen a capability yet', () => {
    const ir = buildIRFromWorkflow({
      name: '초안',
      goal: '분류',
      triggerType: 'manual',
      assumptions: [],
      nodes: [
        { type: 'action', id: 'todo' },
        { type: 'ai_decision', id: 'classify', goal: '위험도 분류' },
      ],
    });

    expect(ir.steps?.some((step) => step.id === 'todo')).toBe(false);
    expect(ir.steps?.some((step) => step.id === 'classify')).toBe(true);
  });
});

describe('AI interview session', () => {
  it('keeps done false while agent nextQuestion still asks the user', async () => {
    const awaitingChannel: InterviewTurn = {
      name: 'PDF 요약',
      goal: 'PDF 요약 후 Slack 전송',
      triggerType: 'local_folder.new_file',
      localFolderId: 'folder-1',
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: { path: '{{filePath}}' },
        },
        { type: 'ai_decision', id: 'summarize', goal: '문서 요약' },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { text: '{{summarize.result}}' },
        },
      ],
      nextQuestion: '요약 내용을 어느 Slack 채널에 보낼까요? (예: #general)',
    };

    const model = new ScriptedModelProvider([awaitingChannel]);
    const harness = createAgentHarness(model);
    const state = await startInterview('폴더 PDF 요약해서 Slack으로', interviewOptions(harness), 'once');

    expect(state.completeness?.deployable).toBe(false);
    expect(state.done).toBe(false);
  });

  it('finalizes deployable drafts from completeness, ignoring model nextQuestion', async () => {
    const confirmTurn: InterviewTurn = {
      ...completeSend,
      nextQuestion: '워크플로우가 완성되었습니다. 지금 실행할까요?',
    };
    const model = new ScriptedModelProvider([confirmTurn]);
    const harness = createAgentHarness(model);
    const state = await startInterview('1분 뒤 테스트 메일 보내줘', interviewOptions(harness), 'once');

    expect(state.completeness?.deployable).toBe(true);
    expect(state.done).toBe(true);
    expect(state.messages.at(-1)?.content).toContain('실행하거나 저장할 수 있습니다');
  });

  it('keeps done false when required slots are still missing even if nextQuestion sounds complete', async () => {
    const confirmTurn: InterviewTurn = {
      ...incompleteSend,
      nextQuestion: '워크플로우가 완성되었습니다. 지금 실행할까요?',
    };
    const model = new ScriptedModelProvider([confirmTurn]);
    const harness = createAgentHarness(model);
    const state = await startInterview('1분 뒤 테스트 메일 보내줘', interviewOptions(harness), 'once');

    expect(state.completeness?.deployable).toBe(false);
    expect(state.done).toBe(false);
    expect(state.messages.at(-1)?.content).not.toContain('지금 실행할까요');
  });

  it('keeps one session and sends full chat history on the next API turn', async () => {
    const model = new ScriptedModelProvider([incompleteSend, completeSend]);
    const harness = createAgentHarness(model);
    const first = await startInterview('1분 뒤 테스트 메일 보내줘', interviewOptions(harness), 'once');
    expect(first.sessionId).toBeTruthy();
    expect(first.done).toBe(false);
    expect(first.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(model.calls[0]?.messages?.map((m) => m.role)).toEqual(['user']);

    const polluted = {
      ...first,
      messages: [
        ...first.messages,
        { role: 'assistant' as const, content: '[interview_discover_1] provider=codex-cli promptChars=1200' },
      ],
    };
    const second = await applyAnswer(polluted, 'test@example.com', interviewOptions(harness));
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.done).toBe(true);
    expect(model.calls[1]?.messages?.map((m) => m.content)).toEqual([
      '1분 뒤 테스트 메일 보내줘',
      'send_mail — 메일을 누구에게 보낼까요?',
      'test@example.com',
    ]);
    expect(model.calls[1]?.system).toContain('현재 workflow');
    expect(model.calls[1]?.system).toContain('gmail.message.send');
    expect(second.draft.steps?.some((s) => s.type === 'action' && s.connector === 'gmail')).toBe(true);
    expect(second.draft.document).toContain('test@example.com');
  });

  it('accepts revision messages after deployable without losing session', async () => {
    const reviseSubject: InterviewTurn = {
      ...completeSend,
      nodes: [
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          params: {
            to: 'test@example.com',
            subject: '변경된 제목',
            body: '테스트 메일입니다.',
          },
        },
      ],
      nextQuestion: '제목을 변경된 제목으로 반영했습니다.',
    };
    const model = new ScriptedModelProvider([incompleteSend, completeSend, reviseSubject]);
    const harness = createAgentHarness(model);
    const first = await startInterview('1분 뒤 테스트 메일 보내줘', interviewOptions(harness), 'once');
    const second = await applyAnswer(first, 'test@example.com', interviewOptions(harness));
    expect(second.done).toBe(true);

    const third = await applyAnswer(second, '제목을 변경된 제목으로 바꿔줘', interviewOptions(harness));
    expect(third.sessionId).toBe(first.sessionId);
    expect(third.done).toBe(true);
    const send = third.draft.steps?.find((s) => s.type === 'action' && s.action === 'message.send');
    expect(send && send.type === 'action' && send.params.subject).toBe('변경된 제목');
  });

  it('seeds manual trigger when an once plan omits its start condition', async () => {
    const withNodes: InterviewTurn = {
      name: 'PDF 위험 분류',
      goal: 'PDF를 분류해 알린다',
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: { path: 'D:\\inbox\\report.pdf' },
        },
        {
          type: 'ai_decision',
          id: 'classify',
          goal: 'critical/high/normal 분류',
          outputFields: [
            { name: 'risk', type: 'string', description: '위험도', enumValues: ['critical', 'high', 'normal'] },
          ],
        },
        {
          type: 'action',
          id: 'critical_slack',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax테스트', text: '{{classify.risk}}' },
        },
      ],
      nextQuestion: 'critical일 때 알릴 Slack 채널을 알려주세요.',
    };

    const model = new ScriptedModelProvider([withNodes]);
    const harness = createAgentHarness(model);
    const first = await startInterview('PDF 분류해서 Slack으로', interviewOptions(harness), 'once');
    expect(first.workflow.nodes.map((node) => node.id)).toEqual(['ingest', 'classify', 'critical_slack']);
    expect(first.workScope).toBe('once');
    expect(first.workflow.triggerType).toBe('manual');
    expect(first.messages.at(-1)?.content).not.toContain('시작 노드');
    expect(first.messages.at(-1)?.content).not.toContain('지금 바로');

    const second = applyInterviewPatch(
      first,
      { set: { 'critical_slack.params.channel': '#ops' } },
      interviewOptions(harness),
    );
    expect(second.workflow.triggerType).toBe('manual');
    expect(second.workflow.nodes.map((node) => node.id)).toEqual(['ingest', 'classify', 'critical_slack']);
  });

  it('does not emit numbered slot questions after the graph is shown', async () => {
    const triggerQuestion = '언제 이 업무를 실행할까요? (예: 새 메일, 매주 금요일)';
    const withEmptySlots: InterviewTurn = {
      name: 'PDF 위험 분류',
      goal: 'PDF를 분류해 알린다',
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: { path: 'D:\\inbox\\report.pdf' },
        },
        {
          type: 'action',
          id: 'critical_slack',
          connector: 'slack',
          action: 'message.send',
          params: {},
        },
      ],
      nextQuestion: triggerQuestion,
    };

    const model = new ScriptedModelProvider([withEmptySlots, { ...withEmptySlots, nextQuestion: triggerQuestion }]);
    const harness = createAgentHarness(model);
    const first = await startInterview('PDF 분류해서 Slack으로', interviewOptions(harness), 'recurring');
    expect(first.workflow.triggerType).toBeUndefined();
    expect(first.messages.at(-1)?.content).toBe(triggerQuestion);
    expect(first.messages.at(-1)?.content).not.toMatch(/^\d+\./m);
  });

  it('asks the interview question instead of a compile error', async () => {
    const broken: InterviewTurn = {
      name: '잘못된 도구',
      goal: '없는 도구',
      triggerType: 'manual',
      assumptions: [],
      nodes: [
        {
          type: 'action',
          id: 'boom',
          connector: 'salesforce',
          action: 'customer.destroy',
          params: {},
        },
      ],
      nextQuestion: '이 알림을 어느 Slack 채널로 보낼까요?',
    };

    const model = new ScriptedModelProvider([broken]);
    const harness = createAgentHarness(model);
    const state = await startInterview('salesforce로 알려줘', interviewOptions(harness), 'once');

    expect(state.done).toBe(false);
    expect(state.messages.at(-1)?.content).toContain('지원하지 않는 capability');
    expect(state.messages.at(-1)?.content).toContain('사용 가능한 연결과 작업');
  });
});
