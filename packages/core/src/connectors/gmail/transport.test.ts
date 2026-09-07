import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { google } from 'googleapis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailConnector } from './connector.js';

let server: Server | undefined;
const context = { executionId: 'transport', variables: {}, log: () => undefined };

afterEach(async () => {
  vi.restoreAllMocks();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function useLoopback(handler: Parameters<typeof createServer>[0]) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const rootUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const createGmail = google.gmail.bind(google);
  const factory = vi.spyOn(google, 'gmail').mockImplementation((options) => createGmail({ ...options, rootUrl }));
  const connector = new GmailConnector({
    clientId: 'test-client', refreshToken: 'test-refresh', accessToken: 'test-access',
    expiryDate: Date.now() + 3_600_000,
  });
  return { connector, factory };
}

describe('Gmail SDK transport', () => {
  it('aborts a pending read using the host abortSignal', async () => {
    let received!: () => void;
    const incoming = new Promise<void>((resolve) => { received = resolve; });
    const { connector, factory } = await useLoopback(() => received());
    const controller = new AbortController();
    const result = connector.execute('messages.search', { query: 'test' }, { ...context, abortSignal: controller.signal });
    await Promise.race([incoming, result.then(() => { throw new Error('request finished before cancellation'); })]);
    controller.abort();
    expect(await result).toMatchObject({ ok: false, errorCode: 'cancelled' });
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal, timeout: 30_000, retry: false }));
  });

  it('returns a provider failure without silently retrying the read', async () => {
    const request = vi.fn((_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 503, message: 'unavailable' } }));
    });
    const { connector } = await useLoopback(request);
    expect(await connector.execute('messages.search', {}, context)).toMatchObject({ ok: false, errorCode: 'gmail_error' });
    expect(request).toHaveBeenCalledOnce();
  });
});
