import { describe, expect, it, vi } from 'vitest';
import { JevDecisionEngine, JevDecisionError } from './jev.js';

describe('JevDecisionEngine', () => {
  it('maps AX boolean questions to TypeSafe noul questions and preserves probabilities', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-latest',
      answers: {
        relevant: { type: 'noul', noul: 0.87 },
      },
      usage: { input_tokens: 123, output_tokens: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const engine = new JevDecisionEngine({
      apiKey: 'test-key',
      headers: {
        Authorization: 'Bearer overridden',
        'Content-Type': 'text/plain',
        'X-Test': 'kept',
      },
      fetch: fetchImpl,
    });
    const result = await engine.evaluate({
      state: { candidate: 'sales table' },
      questions: {
        relevant: {
          type: 'boolean',
          instructions: 'Is this source plausibly relevant?',
        },
      },
    });

    expect(result.answers.relevant).toEqual({ type: 'boolean', probability: 0.87 });
    expect(result.usage).toEqual({ inputTokens: 123, outputTokens: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['X-Test']).toBe('kept');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'jev-latest', state: { candidate: 'sales table' } });
    expect(body.questions).toEqual({
      relevant: {
        type: 'noul',
        instructions: 'Is this source plausibly relevant?',
      },
    });
  });

  it('treats baseURL as an API root like the official SDK', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-latest',
      answers: { relevant: { type: 'noul', noul: 0.5 } },
      usage: { input_tokens: 1, output_tokens: 0 },
    }), { status: 200 }));
    const engine = new JevDecisionEngine({
      apiKey: 'test-key',
      baseURL: 'https://typesafe.example/',
      fetch: fetchImpl,
    });

    await engine.evaluate({
      state: 'x',
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
    });

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://typesafe.example/v1/systemone');
  });

  it('rejects malformed successful responses instead of guessing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      answers: { relevant: { type: 'noul', noul: 2 } },
    }), { status: 200 }));
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'x',
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
    })).rejects.toBeInstanceOf(JevDecisionError);
  });

  it('rejects a choice that was not declared by the caller', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      answers: {
        route: {
          type: 'choice',
          choice: 'not_declared',
          probabilities: { allowed: 0.9, none: 0.1 },
          confidence: 0.9,
        },
      },
    }), { status: 200 }));
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'x',
      questions: {
        route: {
          type: 'choice',
          instructions: 'Choose a route.',
          criteria: { allowed: 'The only allowed route.', none: 'No route.' },
        },
      },
    })).rejects.toThrow('unknown choice');
  });

  it('surfaces provider errors without exposing the API key', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      message: 'not allowed',
    }), { status: 403 }));
    const engine = new JevDecisionEngine({ apiKey: 'secret-key', fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'x',
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
    })).rejects.toMatchObject({ message: 'not allowed', status: 403 });
  });

  it('rejects an oversized provider response before parsing it', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(1_048_577), { status: 200 }));
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'x',
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
    })).rejects.toThrow('too large');
  });

  it('rejects an oversized request before making a network call', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const engine = new JevDecisionEngine({
      apiKey: 'test-key',
      maxRequestBytes: 128,
      fetch: fetchImpl,
    });

    await expect(engine.evaluate({
      state: 'x'.repeat(256),
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
    })).rejects.toThrow('too large');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not start a request for an already-aborted signal', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const controller = new AbortController();
    controller.abort();
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'x',
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propagates an external abort to an in-flight request', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      requestSignal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(requestSignal?.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
        }, { once: true });
      });
    });
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });
    const pending = engine.evaluate({
      state: 'x',
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
      signal: controller.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('allows HTTP only for loopback development endpoints', () => {
    expect(() => new JevDecisionEngine({ apiKey: 'test-key', baseURL: 'http://typesafe.example' }))
      .toThrow('HTTPS');
    expect(() => new JevDecisionEngine({ apiKey: 'test-key', baseURL: 'http://127.0.0.1:8787' }))
      .not.toThrow();
  });
});
