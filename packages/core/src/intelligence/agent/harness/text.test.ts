import { describe, expect, it, vi } from 'vitest';
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
        return '결과를 요약했습니다.';
      },
    };
    const harness = new AgentHarness(provider);

    const result = await harness.runText({
      role: 'command',
      systemPrompt: '답변만 작성한다.',
      context: {
        connectedConnectors: [],
        connectedResources: 'none',
        nowIso: '2026-09-19T00:00:00.000Z',
      },
      user: '결과를 요약해줘',
      logContext: 'test_text_reply',
    });

    expect(result.output).toBe('결과를 요약했습니다.');
    expect(result.policy.maxTurns).toBe(8);
    expect(seen?.system).toContain('답변만 작성한다.');
    expect(seen?.user).toBe('결과를 요약해줘');
    expect(seen?.maxTurns).toBe(1);
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
