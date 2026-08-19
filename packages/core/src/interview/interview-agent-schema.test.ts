import { describe, expect, it } from 'vitest';
import {
  InterviewAgentOutputInnerSchema,
  normalizeInterviewAgentOutput,
  parseInterviewAgentOutput,
} from './interview-agent-schema.js';

describe('interview-agent-schema', () => {
  it('wraps legacy interview turn output as kind=design', () => {
    const parsed = parseInterviewAgentOutput({
      name: 'PDF 요약',
      goal: '요약',
      triggerType: 'manual',
      assumptions: [],
      nodes: [],
      nextQuestion: '이렇게 진행할까요?',
    });
    expect(parsed.kind).toBe('design');
    expect(parsed.nextQuestion).toBe('이렇게 진행할까요?');
  });

  it('wraps toolCalls-only payload as kind=discover', () => {
    const parsed = parseInterviewAgentOutput({
      toolCalls: [{ tool: 'connections.list' }],
    });
    expect(parsed.kind).toBe('discover');
    expect(parsed.toolCalls).toHaveLength(1);
  });

  it('overwrites invalid kind with design when workflow fields are present', () => {
    const parsed = parseInterviewAgentOutput({
      kind: 'workflow',
      name: 'PDF 요약',
      goal: '요약',
      triggerType: 'manual',
      assumptions: [],
      nodes: [],
      nextQuestion: '이렇게 진행할까요?',
    });
    expect(parsed.kind).toBe('design');
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
    expect(parsed.kind).toBe('design');
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
});
