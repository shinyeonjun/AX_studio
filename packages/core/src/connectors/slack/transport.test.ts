import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { WebClientOptions } from '@slack/web-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlackConnector } from './connector.js';

const transport = vi.hoisted(() => ({ url: '', options: undefined as WebClientOptions | undefined }));
vi.mock('@slack/web-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@slack/web-api')>();
  return { ...actual, WebClient: class extends actual.WebClient {
    constructor(token?: string, options?: WebClientOptions) {
      transport.options = options;
      super(token, { ...options, slackApiUrl: transport.url });
    }
  } };
});

let server: Server | undefined;
const context = { executionId: 'transport', variables: {}, log: () => undefined };
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function useLoopback(handler: Parameters<typeof createServer>[0]) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  transport.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return new SlackConnector('test-token');
}

describe('Slack SDK transport', () => {
  it('aborts a pending read using the host abortSignal', async () => {
    let received!: () => void;
    const incoming = new Promise<void>((resolve) => { received = resolve; });
    const connector = await useLoopback(() => received());
    const controller = new AbortController();
    const result = connector.execute('messages.read', { channel: 'C123' }, { ...context, abortSignal: controller.signal });
    await Promise.race([incoming, result.then(() => { throw new Error('request finished before cancellation'); })]);
    controller.abort();
    expect(await result).toMatchObject({ ok: false, errorCode: 'cancelled' });
    expect(transport.options).toMatchObject({ timeout: 30_000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
  });

  it('surfaces rate limiting immediately without waiting or retrying', async () => {
    const request = vi.fn((_req, res) => {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({ ok: false, error: 'ratelimited' }));
    });
    const connector = await useLoopback(request);
    expect(await connector.execute('messages.search', { query: 'test' }, context)).toMatchObject({ ok: false, errorCode: 'slack_error' });
    expect(request).toHaveBeenCalledOnce();
  });

  it('reports the required user-token scope when global search rejects a bot token', async () => {
    const request = vi.fn((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'not_allowed_token_type' }));
    });
    const connector = await useLoopback(request);

    expect(await connector.execute('messages.search', { query: '재고' }, context)).toMatchObject({
      ok: false,
      errorCode: 'slack_search_scope_required',
      errorDetails: { requiredScope: 'search:read', alternativeAction: 'messages.read' },
    });
    expect(request).toHaveBeenCalledOnce();
  });
});
