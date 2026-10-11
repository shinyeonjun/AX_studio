import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicApiProvider, anthropicModelAcceptsTemperature, anthropicRetryDelayMs } from './anthropic-api.js';

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

describe('Anthropic API provider', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'synthetic-key'));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('retries overloaded and rate-limited responses, honoring retry-after', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('overloaded', { status: 529 }))
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(json({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }));
    vi.stubGlobal('fetch', fetchMock);
    const result = new AnthropicApiProvider('claude-sonnet-4-6').generateText({ system: 's', user: 'u' });
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('stops after three attempts and does not retry client errors', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response('down', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = new AnthropicApiProvider('claude-sonnet-4-6').generateText({ system: 's', user: 'u' }).catch(e => e);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const badRequest = vi.fn(async () => new Response('bad', { status: 400 }));
    vi.stubGlobal('fetch', badRequest);
    await expect(new AnthropicApiProvider('claude-sonnet-4-6').generateText({ system: 's', user: 'u' }))
      .rejects.toMatchObject({ status: 400 });
    expect(badRequest).toHaveBeenCalledOnce();
  });

  it('joins every text block and reports truncation as a distinct error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({
      content: [{ type: 'thinking', text: '' }, { type: 'text', text: 'Hello, ' }, { type: 'text', text: 'world' }],
      stop_reason: 'end_turn',
    })));
    await expect(new AnthropicApiProvider('claude-sonnet-4-6').generateText({ system: 's', user: 'u' }))
      .resolves.toBe('Hello, world');

    vi.stubGlobal('fetch', vi.fn(async () => json({ content: [{ type: 'text', text: '{"a":' }], stop_reason: 'max_tokens' })));
    await expect(new AnthropicApiProvider('claude-sonnet-4-6').generateText({ system: 's', user: 'u' }))
      .rejects.toMatchObject({ code: 'model_output_truncated' });
  });

  it('aborts the request when timeoutMs elapses', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })));
    await expect(new AnthropicApiProvider('claude-sonnet-4-6').generateText({ system: 's', user: 'u', timeoutMs: 20 }))
      .rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('omits sampling parameters for models that reject them', async () => {
    const fetchMock = vi.fn(async () => json({ content: [{ type: 'text', text: 'ok' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await new AnthropicApiProvider('claude-sonnet-5-5').generateText({ system: 's', user: 'u' });
    await new AnthropicApiProvider('claude-sonnet-4-6').generateText({ system: 's', user: 'u' });
    const bodies = fetchMock.mock.calls.map(call => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies[0]).not.toHaveProperty('temperature');
    expect(bodies[1]).toHaveProperty('temperature', 0.3);
    expect(anthropicModelAcceptsTemperature('claude-opus-5-5')).toBe(false);
    expect(anthropicModelAcceptsTemperature('claude-haiku-4-5')).toBe(true);
  });

  it('bounds jittered backoff and prefers retry-after', () => {
    expect(anthropicRetryDelayMs(0, '3')).toBe(3_000);
    expect(anthropicRetryDelayMs(10, null, () => 1)).toBe(8_000);
    expect(anthropicRetryDelayMs(1, null, () => 0.5)).toBe(500);
  });
});
