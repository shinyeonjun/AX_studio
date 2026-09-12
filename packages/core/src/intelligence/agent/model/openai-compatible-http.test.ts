import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OpenAICompatibleProvider } from './openai-compatible.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

async function fixture(content: string, hold = false) {
  const requests: Array<{ path: string; authorization?: string;
    body: { model?: string; messages?: unknown[]; tools?: Array<{ function: { name: string } }> } }> = [];
  const responses = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof requests[number]['body'];
    requests.push({ path: request.url!, authorization: request.headers.authorization, body });
    if (hold) { responses.add(response); return; }
    response.writeHead(200, { 'content-type': 'application/json' });
    const toolName = body.tools?.[0]?.function.name;
    const message = toolName
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'structured', type: 'function', function: { name: toolName, arguments: content } }] }
      : { role: 'assistant', content };
    response.end(JSON.stringify({ id: 'local-completion', object: 'chat.completion', created: 1,
      model: 'fixture-model', choices: [{ index: 0, message, finish_reason: toolName ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  cleanup.push(async () => {
    for (const response of responses) response.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  return { requests, provider: new OpenAICompatibleProvider({
    baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: 'fixture-model', apiKey: 'isolated-fixture',
  }) };
}

describe('OpenAI-compatible HTTP contract (no SDK mocks)', () => {
  it('sends the model, system, conversation and image bytes through the actual SDK', async () => {
    const { provider, requests } = await fixture('검증된 응답');
    const text = await provider.generateText({ system: 'system instruction',
      messages: [{ role: 'user', content: 'first' }, { role: 'assistant', content: 'previous' }, { role: 'user', content: 'inspect' }],
      images: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }] });
    expect(text).toBe('검증된 응답');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ path: '/v1/chat/completions', authorization: 'Bearer isolated-fixture',
      body: { model: 'fixture-model', messages: [
        { role: 'system', content: 'system instruction' }, { role: 'user', content: 'first' },
        { role: 'assistant', content: 'previous' }, { role: 'user', content: [
          { type: 'text', text: 'inspect' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
        ] },
      ] } });
  });

  it('validates structured JSON against the application schema', async () => {
    const { provider, requests } = await fixture('{"count":3}');
    expect(await provider.generateStructured({ system: 'return JSON', user: 'count', schema: z.object({ count: z.number() }) }))
      .toEqual({ count: 3 });
    expect(requests).toHaveLength(1);
    expect(requests[0].body.tools?.[0].function.name).toBeTruthy();
  });

  it('rejects a successful HTTP response whose JSON violates the schema', async () => {
    const { provider } = await fixture('{"count":"invalid"}');
    await expect(provider.generateStructured({ system: 'return JSON', user: 'count', schema: z.object({ count: z.number() }) }))
      .rejects.toThrow();
  });

  it.each(['text', 'structured'] as const)('honors the %s timeout when the server never answers', async (mode) => {
    const { provider, requests } = await fixture('', true);
    const controller = new AbortController();
    const watchdog = setTimeout(() => controller.abort(new Error('fixture watchdog: provider timeout ignored')), 1_000);
    try {
      const input = { system: 'test', user: 'wait', timeoutMs: 200, abortSignal: controller.signal };
      const result = await (mode === 'text' ? provider.generateText(input)
        : provider.generateStructured({ ...input, schema: z.object({ count: z.number() }) }))
        .then(() => new Error('unexpected success'), (error: Error) => error);
      expect(result.message).not.toContain('fixture watchdog');
      expect(result.name).toMatch(/TimeoutError|AbortError/);
      expect(requests).toHaveLength(1);
    } finally { clearTimeout(watchdog); }
  });

  it('honors an already cancelled request without contacting the server', async () => {
    const { provider, requests } = await fixture('must not be requested');
    const controller = new AbortController();
    controller.abort(new Error('user cancelled'));
    await expect(provider.generateText({ system: 'test', user: 'cancel', timeoutMs: 1_000, abortSignal: controller.signal }))
      .rejects.toThrow('user cancelled');
    expect(requests).toHaveLength(0);
  });
});
