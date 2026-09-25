import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpConnector } from '../connector.js';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP host cancellation', () => {
  it('does not start an already cancelled request', async () => {
    const fetchMock = vi.fn(async () => new Response('[]'));
    vi.stubGlobal('fetch', fetchMock);
    const connector = new HttpConnector({ baseUrl: 'http://127.0.0.1/' });
    expect(await connector.execute('request', { path: '/' }, {
      executionId: 'cancelled', variables: {}, log: vi.fn(), abortSignal: AbortSignal.abort(),
    })).toMatchObject({ ok: false, errorCode: 'aborted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a real in-flight response and closes its local socket', async () => {
    const controller = new AbortController();
    let requestStarted!: () => void;
    const started = new Promise<void>(resolve => { requestStarted = resolve; });
    let socketClosed!: () => void;
    const closed = new Promise<void>(resolve => { socketClosed = resolve; });
    const server = createServer((_request, response) => {
      response.socket!.once('close', socketClosed);
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('partial');
      requestStarted();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing_test_port');
    const connector = new HttpConnector({ baseUrl: `http://127.0.0.1:${address.port}/` });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settleWatchdog!: (value: string) => void;
    try {
      const pending = connector.execute('request', { path: '/' }, {
        executionId: 'cancelled', variables: {}, log: vi.fn(), abortSignal: controller.signal,
      });
      await started;
      controller.abort();
      const result = await Promise.race([
        pending,
        new Promise<string>(resolve => {
          settleWatchdog = resolve;
          timer = setTimeout(() => resolve('did_not_cancel'), 500);
        }),
      ]);
      expect(result).toMatchObject({ ok: false, errorCode: 'aborted' });
      await closed;
    } finally {
      clearTimeout(timer);
      settleWatchdog?.('cancelled');
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
