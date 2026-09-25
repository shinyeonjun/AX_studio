import { describe, expect, it, vi } from 'vitest';
import { AnthropicApiProvider } from './anthropic-api.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import { reportModelTokenUsage } from './provider.js';

describe('provider token usage', () => {
  it('reports only finite nonnegative integer fields and tolerates observer failures', () => {
    const onUsage = vi.fn();
    reportModelTokenUsage({ onUsage }, {
      inputTokens: 11,
      outputTokens: undefined,
      totalTokens: 15,
      cachedInputTokens: -1,
      reasoningTokens: Number.NaN,
    });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 11, totalTokens: 15 });

    expect(() => reportModelTokenUsage({ onUsage: () => { throw new Error('observer_failed'); } }, {
      inputTokens: 1,
    })).not.toThrow();
  });

  it('maps Anthropic cache and generation counts from the actual Messages response', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    try {
      const onUsage = vi.fn();
      const output = await new AnthropicApiProvider('test-model').generateText({
        system: 'system', user: 'hello', onUsage,
      });
      expect(output).toBe('ok');
      expect(onUsage).toHaveBeenCalledWith({
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 10,
        totalTokens: 135,
      });
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('maps OpenAI-compatible SDK usage for text generation', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 13,
        completion_tokens: 4,
        total_tokens: 17,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 2 },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const provider = new OpenAICompatibleProvider({
        baseURL: 'https://provider.invalid/v1', apiKey: 'test-key', model: 'test-model',
      });
      const onUsage = vi.fn();
      await expect(provider.generateText({ system: 'system', user: 'hello', onUsage })).resolves.toBe('ok');
      expect(onUsage).toHaveBeenCalledWith({
        inputTokens: 13,
        outputTokens: 4,
        totalTokens: 17,
        cachedInputTokens: 3,
        reasoningTokens: 2,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
