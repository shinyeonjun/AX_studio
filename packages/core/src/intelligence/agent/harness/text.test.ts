import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentHarness } from '../harness.js';
import type { ModelProvider, TextGenerateInput } from '../model/provider.js';

describe('agent text harness', () => {
  it('runs a text-only finalizer through the same bounded harness policy', async () => {
    let seen: TextGenerateInput | undefined;
    const provider: ModelProvider = {
      name: 'mock',
      async generateStructured<T>(): Promise<T> {
        throw new Error('structured_generation_not_used');
      },
      async generateText(input): Promise<string> {
        seen = input;
        input.onUsage?.({ inputTokens: 23, outputTokens: 7, totalTokens: 30 });
        return '결과를 요약했습니다.';
      },
    };
    const harness = new AgentHarness(provider);

    const result = await harness.runText({
      role: 'command',
      systemPrompt: '답변만 작성한다.',
      user: '결과를 요약해줘',
      logContext: 'test_text_reply',
    });

    expect(result.output).toBe('결과를 요약했습니다.');
    expect(result.usage).toEqual({ inputTokens: 23, outputTokens: 7, totalTokens: 30 });
    expect(result.policy.maxTurns).toBe(8);
    expect(seen?.system).toContain('답변만 작성한다.');
    expect(seen?.user).toBe('결과를 요약해줘');
    expect(seen?.maxTurns).toBe(1);
    expect(seen?.maxOutputTokens).toBe(768);
    await harness.dispose();
  });

  it('uses the required investigation context when building a text investigation prompt', async () => {
    let seen: TextGenerateInput | undefined;
    const provider: ModelProvider = {
      name: 'mock',
      async generateStructured<T>(): Promise<T> {
        throw new Error('structured_generation_not_used');
      },
      async generateText(input): Promise<string> {
        seen = input;
        return 'investigation summary';
      },
    };
    const harness = new AgentHarness(provider);

    await harness.runText({
      role: 'investigate',
      context: {
        skillGoal: 'text investigation skill',
        taskGoal: 'INVESTIGATION_CONTEXT_SENTINEL',
        evidence: [],
        connectedConnectors: [],
      },
      user: 'Summarize the evidence.',
    });

    expect(seen?.system).toContain('INVESTIGATION_CONTEXT_SENTINEL');
    await harness.dispose();
  });

  it('returns provider-reported usage for structured calls', async () => {
    const provider: ModelProvider = {
      name: 'mock',
      async generateStructured<T>(input): Promise<T> {
        input.onUsage?.({ inputTokens: 31, outputTokens: 9, totalTokens: 40 });
        return input.schema.parse({ answer: 'ok' });
      },
      async generateText(): Promise<string> {
        throw new Error('text_generation_not_used');
      },
    };
    const harness = new AgentHarness(provider);
    const result = await harness.run({
      role: 'investigate',
      outputSchema: z.object({ answer: z.string() }),
      context: {
        skillGoal: 'test', taskGoal: 'test', evidence: [], connectedConnectors: [],
      },
      user: 'test',
    });

    expect(result.output).toEqual({ answer: 'ok' });
    expect(result.usage).toEqual({ inputTokens: 31, outputTokens: 9, totalTokens: 40 });
    await harness.dispose();
  });

  it('rejects a text provider that returns after cancellation', async () => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const provider: ModelProvider = {
        name: 'mock',
        async generateStructured<T>(): Promise<T> {
          throw new Error('structured_generation_not_used');
        },
        async generateText(): Promise<string> {
          return new Promise(resolve => { release = () => resolve('late reply'); });
        },
      };
      const harness = new AgentHarness(provider);
      const abort = new AbortController();
      const result = harness.runText({
        role: 'command',
        context: { connectedConnectors: [], connectedResources: 'none', nowIso: 'now' },
        user: '취소될 답변',
        abortSignal: abort.signal,
      }).catch(error => error);

      await Promise.resolve();
      abort.abort();
      release();
      await expect(result).resolves.toMatchObject({ code: 'agent_aborted' });
      await harness.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
