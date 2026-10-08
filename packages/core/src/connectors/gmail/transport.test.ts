import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GmailConnector } from './connector.js';

const gmailMock = vi.hoisted(() => ({ factory: vi.fn(), actual: undefined as unknown as typeof import('@googleapis/gmail').gmail }));
vi.mock('@googleapis/gmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@googleapis/gmail')>();
  gmailMock.actual = actual.gmail;
  return { ...actual, gmail: gmailMock.factory };
});

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

async function useLoopback(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const rootUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const factory = gmailMock.factory.mockImplementation((options: Parameters<typeof gmailMock.actual>[0]) => gmailMock.actual({ ...(options as object), rootUrl } as never));
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
    const requestHandler: RequestListener = (_req, res) => {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 503, message: 'unavailable' } }));
    };
    const request = vi.fn(requestHandler);
    const { connector } = await useLoopback(request);
    expect(await connector.execute('messages.search', {}, context)).toMatchObject({ ok: false, errorCode: 'gmail_error' });
    expect(request).toHaveBeenCalledOnce();
  });
});
