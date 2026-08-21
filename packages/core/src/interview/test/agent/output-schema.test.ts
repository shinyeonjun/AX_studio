import { describe, expect, it } from 'vitest';
import {
  InterviewAgentOutputInnerSchema,
  normalizeInterviewAgentOutput,
  parseInterviewAgentOutput,
} from '../../agent/output-schema.js';

describe('interview-agent-schema', () => {
  it('wraps legacy interview turn output as kind=plan', () => {
    const parsed = parseInterviewAgentOutput({
      name: 'PDF 요약',
      goal: '요약',
      triggerType: 'manual',
      assumptions: [],
      nodes: [],
      nextQuestion: '이렇게 진행할까요?',
    });
    expect(parsed.kind).toBe('plan');
    expect(parsed.nextQuestion).toBe('이렇게 진행할까요?');
  });

  it('wraps toolCalls-only payload as kind=discover', () => {
    const parsed = parseInterviewAgentOutput({
      toolCalls: [{ tool: 'connections.list' }],
    });
    expect(parsed.kind).toBe('discover');
    expect(parsed.toolCalls).toHaveLength(1);
  });

  it('overwrites invalid kind with plan when workflow fields are present', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'workflow',
      name: 'PDF 요약',
      goal: '요약',
      triggerType: 'manual',
      assumptions: [],
      nodes: [],
      nextQuestion: '이렇게 진행할까요?',
    });
    expect(parsed.kind).toBe('plan');
  });

  it('unwraps Claude CLI envelope when structured_output is empty', () => {
    const parsed = parseInterviewAgentOutput({
      type: 'result',
      structured_output: {},
      result: JSON.stringify({
        name: 'PDF 요약',
        goal: '요약',
        triggerType: 'manual',
        assumptions: [],
        nodes: [],
        nextQuestion: '이렇게 진행할까요?',
      }),
    });
    expect(parsed.kind).toBe('plan');
    expect(parsed.nextQuestion).toBe('이렇게 진행할까요?');
  });

  it('preserves explicit kind=discover', () => {
    const normalized = normalizeInterviewAgentOutput({
      kind: 'discover',
      toolCalls: [{ tool: 'sources.list', args: { connector: 'local_folder' } }],
    });
    expect(normalized).toMatchObject({ kind: 'discover' });
    expect(InterviewAgentOutputInnerSchema.safeParse(normalized).success).toBe(true);
  });

  it('keeps kind=discover when toolCalls is empty so discovery loop can retry', () => {
    const normalized = normalizeInterviewAgentOutput({
      kind: 'discover',
      toolCalls: [],
    });
    expect(normalized).toMatchObject({ kind: 'discover', toolCalls: [] });
    expect(InterviewAgentOutputInnerSchema.safeParse(normalized).success).toBe(false);
  });

  it('coerces kind=discover with empty toolCalls to plan when workflow fields exist', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'discover',
      toolCalls: [],
      name: 'PDF 요약',
      goal: '요약',
      triggerType: 'manual',
      assumptions: [],
      nodes: [],
      nextQuestion: '이렇게 진행할까요?',
    });
    expect(parsed.kind).toBe('plan');
  });

  it('truncates discover toolCalls to the schema maximum', () => {
    const toolCalls = Array.from({ length: 8 }, () => ({ tool: 'connections.list' as const }));
    const parsed = parseInterviewAgentOutput({ kind: 'discover', toolCalls });
    expect(parsed.kind).toBe('discover');
    expect(parsed.toolCalls).toHaveLength(5);
  });

  it('parses patch output', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'patch',
      patch: { set: { 'notify.params.channel': '#ops' } },
      nextQuestion: '반영했습니다.',
    });
    expect(parsed.kind).toBe('patch');
    if (parsed.kind !== 'patch') return;
    expect(parsed.patch.set['notify.params.channel']).toBe('#ops');
  });

  it('parses Codex string-encoded records back into workflow values', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'plan',
      name: 'Slack 알림',
      goal: '조건에 따라 알림',
      triggerType: 'manual',
      nodes: [
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: '{"channel":"#ops","text":"확인"}',
        },
        {
          type: 'if',
          id: 'branch',
          condition: '{"op":"eq","left":{"ref":"status"},"right":{"lit":"critical"}}',
        },
      ],
      nextQuestion: '완료했습니다.',
    });

    const discovery = parseInterviewAgentOutput({
      kind: 'discover',
      toolCalls: [{ tool: 'sources.list', args: '{"connector":"local_folder"}' }],
    });

    if (parsed.kind !== 'plan') throw new Error('expected plan');
    expect(parsed.plan.nodes[0]?.params).toEqual({ channel: '#ops', text: '확인' });
    expect(parsed.plan.nodes[1]?.condition).toEqual({
      op: 'eq',
      left: { ref: 'status' },
      right: { lit: 'critical' },
    });
    expect(discovery.toolCalls?.[0]?.args).toEqual({ connector: 'local_folder' });
  });

  it('parses string-encoded bindings on workflow nodes', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'plan',
      name: 'PDF Slack',
      goal: 'PDF를 요약해 Slack으로',
      triggerType: 'local_folder.new_file',
      localFolderId: 'folder-1',
      nodes: [
        {
          type: 'action',
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          bindings: '{"path":{"from":"trigger","output":"filePath"}}',
        },
        {
          type: 'ai_decision',
          id: 'summarize',
          goal: 'PDF 요약',
          bindings: {
            context: '{"from":"ingest","output":"text"}',
          },
        },
      ],
      nextQuestion: '완료했습니다.',
    });

    if (parsed.kind !== 'plan') throw new Error('expected plan');
    expect(parsed.plan.nodes[0]?.bindings).toEqual({
      path: { from: 'trigger', output: 'filePath' },
    });
    expect(parsed.plan.nodes[1]?.bindings).toEqual({
      context: { from: 'ingest', output: 'text' },
    });
  });

  it('accepts empty conditions and nested workflow bindings', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'plan',
      name: '메일 요약',
      goal: '메일을 읽고 요약한다',
      triggerType: 'manual',
      nodes: [
        {
          type: 'action',
          id: 'read-mails',
          connector: 'gmail',
          action: 'messages.read',
          params: '{"messageId":{"ref":"search-mails.messageId"}}',
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: {
            channel: '#ops',
            text: { ref: 'summarize-mails.summary' },
          },
        },
      ],
      nextQuestion: '완료했습니다.',
    });

    if (parsed.kind !== 'plan') throw new Error('expected plan');
    expect(parsed.plan.nodes[0]?.condition).toBeUndefined();
    expect(parsed.plan.nodes[0]?.params).toEqual({
      messageId: { ref: 'search-mails.messageId' },
    });
    expect(parsed.plan.nodes[1]?.params).toEqual({
      channel: '#ops',
      text: { ref: 'summarize-mails.summary' },
    });
  });

  it('coerces string shorthand bindings on action nodes', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'plan',
      name: 'PDF Slack',
      goal: 'PDF를 요약해 Slack과 Gmail으로',
      triggerType: 'local_folder.new_file',
      localFolderId: 'folder-1',
      nodes: [
        {
          type: 'action',
          id: 'notify-slack',
          connector: 'slack',
          action: 'message.send',
          bindings: {
            text: 'summarize.summary',
          },
        },
        {
          type: 'action',
          id: 'notify-gmail',
          connector: 'gmail',
          action: 'message.send',
          bindings: {
            body: { ref: 'summarize.body' },
          },
        },
      ],
      nextQuestion: '완료했습니다.',
    });

    if (parsed.kind !== 'plan') throw new Error('expected plan');
    expect(parsed.plan.nodes[0]?.bindings).toEqual({
      text: { from: 'summarize', output: 'summary' },
    });
    expect(parsed.plan.nodes[1]?.bindings).toEqual({
      body: { from: 'summarize', output: 'body' },
    });
  });

  it('parses a trigger filter without embedding any domain-specific value', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'plan',
      name: '조건부 알림',
      goal: '조건에 맞는 이벤트를 알린다',
      triggerType: 'gmail.new_message',
      gmailAccount: 'primary',
      triggerFilter: '{"op":"eq","left":{"ref":"from"},"right":{"lit":"sender@example.com"}}',
      nodes: [],
      nextQuestion: '완료했습니다.',
    });

    if (parsed.kind !== 'plan') throw new Error('expected plan');
    expect(parsed.plan.triggerFilter).toEqual({
      op: 'eq',
      left: { ref: 'from' },
      right: { lit: 'sender@example.com' },
    });
  });

  it('normalizes triggerFilter and/or with left-right from interview output', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'plan',
      name: '네이버 메일 Slack 요약',
      goal: '네이버 메일만 요약해 Slack으로',
      triggerType: 'gmail.new_message',
      gmailAccount: 'primary',
      triggerFilter: {
        op: 'and',
        left: { op: 'contains', left: { ref: 'from' }, right: { lit: 'naver.com' } },
        right: { op: 'contains', left: { ref: 'subject' }, right: { lit: '메일' } },
      },
      nodes: [],
      nextQuestion: '완료했습니다.',
    });

    if (parsed.kind !== 'plan') throw new Error('expected plan');
    expect(parsed.plan.triggerFilter).toEqual({
      op: 'and',
      args: [
        { op: 'contains', left: { ref: 'from' }, right: { lit: 'naver.com' } },
        { op: 'contains', left: { ref: 'subject' }, right: { lit: '메일' } },
      ],
    });
  });

  it('normalizes triggerFilter field/value shape from interview output', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'plan',
      name: '네이버 메일 Slack',
      goal: '네이버 메일만 요약해 Slack으로',
      triggerType: 'gmail.new_message',
      gmailAccount: 'primary',
      triggerFilter: { op: 'contains', field: 'from', value: 'naver.com' },
      nodes: [],
      nextQuestion: '완료했습니다.',
    });

    if (parsed.kind !== 'plan') throw new Error('expected plan');
    expect(parsed.plan.triggerFilter).toEqual({
      op: 'contains',
      left: { ref: 'from' },
      right: { lit: 'naver.com' },
    });
  });
});
