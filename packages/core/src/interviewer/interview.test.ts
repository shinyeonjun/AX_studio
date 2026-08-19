import { describe, expect, it } from 'vitest';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../agents-harness/model/provider.js';
import { chatMessagesFromInput, flattenChatPrompt, normalizeChatMessages } from '../agents-harness/model/chat.js';
import { composedPrompt } from '../agents-harness/model/cli/shared.js';
import { createAgentHarness } from '../agents-harness/harness.js';
import { applyAnswer, startInterview } from './interview-flow.js';
import { buildIRFromWorkflow } from './workflow-builder.js';
import type { InterviewTurn } from './workflow-schema.js';
import { loadAgentSkill } from '../agents-harness/skill-load.js';

class ScriptedModelProvider implements ModelProvider {
  readonly name = 'scripted';
  readonly calls: StructuredGenerateInput<unknown>[] = [];
  private index = 0;

  constructor(private turns: InterviewTurn[]) {}

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.calls.push(input as StructuredGenerateInput<unknown>);
    const turn = this.turns[Math.min(this.index, this.turns.length - 1)];
    this.index += 1;
    return input.schema.parse(turn);
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

const CONNECTED = ['gmail', 'slack', 'local_sheet', 'rdb', 'report'];

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
};

describe('agent interview skill', () => {
  it('loads SKILL.md from disk', () => {
    const skill = loadAgentSkill('interview');
    expect(skill.name).toBe('interview');
    expect(skill.body).toContain('{{workflow_json}}');
    expect(skill.body).toContain('gmail.message.send');
  });

  it('prepends AGENTS.md constitution via harness system prompt', async () => {
    const model = new ScriptedModelProvider([incompleteSend]);
    const harness = createAgentHarness(model);
    const first = await startInterview('안녕', { harness, connectedConnectors: CONNECTED });
    expect(first.messages).toHaveLength(2);
    expect(model.calls[0]?.system).toContain('AX Studio Agent 헌법');
    expect(model.calls[0]?.system).toContain('대화가 워크플로우 에디터');
    expect(model.calls[0]?.system).toContain('현재 워크플로우 초안');
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
  it('resolves gmail send alias, injects approval, and fills default AI schema', () => {
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
    expect(decision && decision.type === 'ai_decision' && decision.outputSchema).toBeTruthy();
    expect(ir.document).toContain('# 메일');
    expect(ir.document).toContain('gmail.message.send');
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
});

describe('AI interview session', () => {
  it('keeps one session and sends full chat history on the next API turn', async () => {
    const model = new ScriptedModelProvider([incompleteSend, completeSend]);
    const harness = createAgentHarness(model);
    const first = await startInterview('1분 뒤 테스트 메일 보내줘', { harness, connectedConnectors: CONNECTED });
    expect(first.sessionId).toBeTruthy();
    expect(first.done).toBe(false);
    expect(first.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(model.calls[0]?.messages?.map((m) => m.role)).toEqual(['user']);

    const second = await applyAnswer(first, 'test@example.com', { harness, connectedConnectors: CONNECTED });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.done).toBe(true);
    expect(model.calls[1]?.messages?.map((m) => m.content)).toEqual([
      '1분 뒤 테스트 메일 보내줘',
      '메일을 누구에게 보낼까요?',
      'test@example.com',
    ]);
    expect(model.calls[1]?.system).toContain('현재 워크플로우 초안');
    expect(model.calls[1]?.system).toContain('gmail.message.send');
    expect(second.draft.steps?.some((s) => s.type === 'action' && s.connector === 'gmail')).toBe(true);
    expect(second.draft.document).toContain('test@example.com');
  });
});
