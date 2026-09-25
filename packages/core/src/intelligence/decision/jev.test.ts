import { describe, expect, it, vi } from 'vitest';
import { JevDecisionEngine, JevDecisionError } from './jev.js';

describe('JevDecisionEngine', () => {
  it('shares the 255-choice wire ceiling and rejects the next option before network I/O', async () => {
    const choices = (count: number) => Object.fromEntries(
      Array.from({ length: count }, (_, index) => [`option_${index}`, `Option ${index}`]),
    );
    const acceptedCriteria = choices(255);
    const acceptedProbabilities = Object.fromEntries(
      Object.keys(acceptedCriteria).map((key, index) => [key, index === 254 ? 0.96 : 0.04 / 254]),
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-latest',
      answers: { category: { type: 'choice', choice: 'option_254', probabilities: acceptedProbabilities } },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'classify',
      questions: { category: { type: 'choice', instructions: 'Choose an option.', criteria: acceptedCriteria } },
    })).resolves.toMatchObject({ answers: { category: { choice: 'option_254' } } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const unusedFetch = vi.fn<typeof fetch>();
    const restrictedEngine = new JevDecisionEngine({ apiKey: 'test-key', fetch: unusedFetch });
    await expect(restrictedEngine.evaluate({
      state: 'classify',
      questions: { category: { type: 'choice', instructions: 'Choose an option.', criteria: choices(256) } },
    })).rejects.toThrow('1-255 criteria');
    expect(unusedFetch).not.toHaveBeenCalled();
  });

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

  it('surfaces TypeSafe nested provider error types', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      detail: { error_type: 'max_tokens_exceeded' },
    }), { status: 400 }));
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'x',
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
    })).rejects.toMatchObject({ message: 'max_tokens_exceeded', status: 400 });
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

  it('splits independent questions by request bytes and bounds concurrent batches', async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    const requestBodyBytes: number[] = [];
    const questions = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`q${index}`, {
      type: 'boolean' as const, instructions: '이 항목이 관련 있나요?',
    }]));
    const state = { task: 'classify', questions: {} };
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      activeRequests += 1;
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      const bodyText = String(init?.body);
      const bodyBytes = new TextEncoder().encode(bodyText).byteLength;
      requestBodyBytes.push(bodyBytes);
      expect(bodyBytes).toBeLessThanOrEqual(320);
      const body = JSON.parse(bodyText) as { questions: Record<string, unknown> };
      expect(JSON.parse(bodyText).state).toEqual(state);
      const answers = Object.fromEntries(Object.keys(body.questions).map(id => [id, { type: 'noul', noul: 0.9 }]));
      await new Promise(resolve => setTimeout(resolve, 1));
      activeRequests -= 1;
      return new Response(JSON.stringify({ model: 'jev-latest', answers, usage: { input_tokens: 2, output_tokens: 1 } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    });
    const engine = new JevDecisionEngine({ apiKey: 'test-key', maxRequestBytes: 320, fetch: fetchImpl });

    const result = await engine.evaluate({ state, questions });

    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
    expect(fetchImpl.mock.calls.length).toBeLessThan(Object.keys(questions).length);
    expect(maxActiveRequests).toBeGreaterThan(1);
    expect(maxActiveRequests).toBeLessThanOrEqual(4);
    expect(result.answers).toEqual(Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'boolean', probability: 0.9 }])));
    expect(result.usage).toEqual({ inputTokens: fetchImpl.mock.calls.length * 2, outputTokens: fetchImpl.mock.calls.length });
    expect(result.providerRequestCount).toBe(fetchImpl.mock.calls.length);
    expect(result.requestBytes).toBe(requestBodyBytes.reduce((total, bytes) => total + bytes, 0));
  });

  it('aborts sibling batches when one split request fails', async () => {
    const signals: AbortSignal[] = [];
    const requestBodyBytes: number[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal as AbortSignal;
      signals.push(signal);
      requestBodyBytes.push(new TextEncoder().encode(String(init?.body)).byteLength);
      if (signals.length === 1) {
        return await new Promise<Response>((_resolve, reject) => {
          const rejectOnAbort = () => reject(signal.reason ?? new DOMException('Aborted.', 'AbortError'));
          if (signal.aborted) rejectOnAbort();
          else signal.addEventListener('abort', rejectOnAbort, { once: true });
        });
      }
      return new Response(JSON.stringify({ message: 'provider failed' }), { status: 503 });
    });
    const engine = new JevDecisionEngine({ apiKey: 'test-key', maxRequestBytes: 220, fetch: fetchImpl });
    const questions = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`q${index}`, {
      type: 'boolean' as const, instructions: 'Is this relevant?',
    }]));

    const error = await engine.evaluate({ state: 'classify', questions }).then(
      () => undefined,
      failure => failure,
    );

    expect(signals.length).toBeGreaterThan(1);
    expect(signals[0]?.aborted).toBe(true);
    expect(error).toMatchObject({
      status: 503,
      providerRequestCount: fetchImpl.mock.calls.length,
      requestBytes: requestBodyBytes.reduce((total, bytes) => total + bytes, 0),
    });
  });

  it('reports the provider request count when a request fails after it starts', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('network unavailable'));
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'classify',
      questions: { relevant: { type: 'boolean', instructions: 'Relevant?' } },
    })).rejects.toMatchObject({ message: 'network unavailable', providerRequestCount: 1, requestBytes: expect.any(Number) });
  });

  it('keeps a fitting multi-question evaluation as one network call', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-latest',
      answers: {
        first: { type: 'noul', noul: 0.8 },
        second: { type: 'noul', noul: 0.2 },
      },
    }), { status: 200 }));
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });

    await engine.evaluate({
      state: 'classify',
      questions: {
        first: { type: 'boolean', instructions: 'First?' },
        second: { type: 'boolean', instructions: 'Second?' },
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rejects a single question that cannot fit without making a network call', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const engine = new JevDecisionEngine({ apiKey: 'test-key', maxRequestBytes: 220, fetch: fetchImpl });

    await expect(engine.evaluate({
      state: 'classify',
      questions: { relevant: { type: 'boolean', instructions: 'x'.repeat(512) } },
    })).rejects.toThrow('too large');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves a question whose id is a JavaScript prototype property', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: 'jev-latest',
      answers: Object.fromEntries([['__proto__', { type: 'noul', noul: 0.9 }]]),
    }), { status: 200 }));
    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });
    const questions = Object.fromEntries([['__proto__', { type: 'boolean' as const, instructions: 'Relevant?' }]]);

    const result = await engine.evaluate({ state: 'classify', questions });

    expect(Object.hasOwn(result.answers, '__proto__')).toBe(true);
    expect(result.answers['__proto__']).toEqual({ type: 'boolean', probability: 0.9 });
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
