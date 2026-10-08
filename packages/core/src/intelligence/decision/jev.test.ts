import { describe, expect, it, vi } from 'vitest';
import { JevDecisionEngine, JevDecisionError } from './jev.js';

describe('host parser clean-omission provenance', () => {
  const question = { type: 'choice' as const, instructions: 'Select a registered schema operation.', criteria: { metadata_0: 'Schema', unknown: 'Unknown' } };
  const request = { state: { phase: 'metadata_operation' }, questions: { metadataOperationRef: question } };
  it('preserves the typed sole-slot omission and dispatch byte accounting through evaluate', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ answers: {}, model: 'offline', usage: { input_tokens: 5, output_tokens: 0 } }));
    const engine = new JevDecisionEngine({ apiKey: 'offline-test', fetch: fetchImpl });
    let failure: unknown;
    try { await engine.evaluate(request); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(JevDecisionError);
    expect(failure).toMatchObject({ failure: { kind: 'missing_answer', questionRef: 'metadataOperationRef' },
      providerRequestCount: 1, requestBytes: Buffer.byteLength(String(fetchImpl.mock.calls[0]![1]?.body), 'utf8') });
    expect((failure as JevDecisionError).cause).toBeInstanceOf(JevDecisionError);
    expect(Object.isFrozen((failure as JevDecisionError).failure)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    { id: 'wrong_question', body: { answers: { wrong_question: { type: 'choice', choice: 'metadata_0', probabilities: { metadata_0: 1 } } } } },
    { id: 'provider_error_with_http_200', body: { answers: {}, error: { type: 'permission_denied', message: 'synthetic refusal' } } },
    { id: 'undeclared_envelope_key', body: { answers: {}, extra: 'undeclared' } },
    { id: 'missing_answers', body: {} },
    { id: 'null_answers', body: { answers: null } },
    { id: 'array_answers', body: { answers: [] } },
    { id: 'malformed_answer', body: { answers: { metadataOperationRef: { type: 'choice' } } } },
    { id: 'malformed_unrequested_answer', body: { answers: { wrong_question: { type: 'choice' } } } },
    { id: 'invalid_usage_envelope', body: { answers: {}, usage: { input_tokens: 'invalid' } } },
    { id: 'invalid_model_envelope', body: { answers: {}, model: {} } },
    { id: 'nonobject_envelope', body: 'invalid' },
  ])('$id cannot acquire a clean-omission tag', async ({ body }) => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
    const engine = new JevDecisionEngine({ apiKey: 'offline-test', fetch: fetchImpl });
    await expect(engine.evaluate(request)).rejects.toMatchObject({ name: 'JevDecisionError', failure: undefined, providerRequestCount: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('HTTP and transport errors cannot acquire parser provenance from their messages', async () => {
    for (const transport of [false, true]) {
      const fetchImpl = vi.fn<typeof fetch>(async () => {
        if (transport) throw new Error('TypeSafe response is missing answer metadataOperationRef.');
        return Response.json({ answers: {}, error: 'TypeSafe response is missing answer metadataOperationRef.' }, { status: 503 });
      });
      const engine = new JevDecisionEngine({ apiKey: 'offline-test', fetch: fetchImpl });
      // A 503 is retried (twice) before failing; a thrown non-network error is not.
      const attempts = transport ? 1 : 3;
      await expect(engine.evaluate(request)).rejects.toMatchObject({ failure: undefined, providerRequestCount: attempts });
      expect(fetchImpl).toHaveBeenCalledTimes(attempts);
    }
  });

  it('an empty answer to a multi-question request stays ineligible even after splitting', async () => {
    for (const maxRequestBytes of [65_536, 350]) {
      const long = { ...question, instructions: 'x'.repeat(120) };
      const engine = new JevDecisionEngine({ apiKey: 'offline-test', maxRequestBytes,
        fetch: vi.fn<typeof fetch>(async () => Response.json({ answers: {} })) });
      await expect(engine.evaluate({ state: {}, questions: { metadataOperationRef: long, other: long } }))
        .rejects.toMatchObject({ failure: undefined });
    }
  });
});

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
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('x-test')).toBe('kept');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'jev-latest', state: { candidate: 'sales table' } });
    expect(body.questions).toEqual({
      relevant: {
        type: 'noul',
        instructions: 'Is this source plausibly relevant?',
      },
    });
  });

  it('rejects non-ASCII, whitespace, and control characters in synthetic API keys before request I/O', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const invalidKeys = ['synthetic\uD55C\uAE00', 'synthetic\nkey', ' synthetic-key', 'synthetic-key ', 'synthetic key'];

    expect(() => new Headers({ Authorization: 'Bearer \uD55C\uAE00' })).toThrow(/ByteString.*index 7/i);
    for (const apiKey of invalidKeys) {
      expect(() => new JevDecisionEngine({ apiKey, fetch: fetchImpl })).toThrow(/ASCII bearer tokens/);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('validates the final request headers before counting or starting a fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const engine = new JevDecisionEngine({
      apiKey: 'synthetic-token-123',
      headers: { 'X-Test': '합성값' },
      fetch: fetchImpl,
    });

    await expect(engine.evaluate({
      state: 'check',
      questions: { reachable: { type: 'boolean', instructions: 'Reachable?' } },
    })).rejects.toMatchObject({
      message: 'TypeSafe request headers are invalid. Check the API key and custom headers, then try again.',
      providerRequestCount: 0,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
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
    })).rejects.toMatchObject({ message: 'network unavailable', providerRequestCount: 3, requestBytes: expect.any(Number) });
  });

  it('retries a briefly unavailable provider, and never a request it refused', async () => {
    const ok = () => new Response(JSON.stringify({ model: 'jev-latest', answers: { relevant: { type: 'noul', noul: 0.9 } } }), { status: 200 });
    const unavailable = () => Response.json({ error: 'model_unavailable' }, { status: 503, headers: { 'retry-after': '0' } });
    const flaky = vi.fn<typeof fetch>().mockResolvedValueOnce(unavailable()).mockResolvedValueOnce(ok());
    const question = { state: 'classify', questions: { relevant: { type: 'boolean' as const, instructions: 'Relevant?' } } };
    await expect(new JevDecisionEngine({ apiKey: 'test-key', fetch: flaky }).evaluate(question))
      .resolves.toMatchObject({ answers: { relevant: { type: 'boolean', probability: 0.9 } } });
    expect(flaky).toHaveBeenCalledTimes(2);

    const refused = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'bad request' }, { status: 400 }));
    await expect(new JevDecisionEngine({ apiKey: 'test-key', fetch: refused }).evaluate(question)).rejects.toMatchObject({ status: 400 });
    expect(refused).toHaveBeenCalledOnce();
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
    let requestSignal: AbortSignal | null | undefined;
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
