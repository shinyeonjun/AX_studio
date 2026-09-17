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

    const engine = new JevDecisionEngine({ apiKey: 'test-key', fetch: fetchImpl });
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
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-key');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'jev-latest', state: { candidate: 'sales table' } });
    expect(body.questions).toEqual({
      relevant: {
        type: 'noul',
        instructions: 'Is this source plausibly relevant?',
      },
    });
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
});
