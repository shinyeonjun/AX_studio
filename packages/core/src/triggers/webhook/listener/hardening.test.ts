import { createServer, request } from 'node:http';
import { connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookInboundListener } from '../listener.js';

vi.mock('node:http', async importOriginal => {
  const actual = await importOriginal<typeof import('node:http')>();
  return { ...actual, createServer: vi.fn(actual.createServer) };
});

afterEach(async () => {
  for (const result of vi.mocked(createServer).mock.results) {
    if (result.type !== 'return') continue;
    const server = result.value;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  vi.mocked(createServer).mockClear();
});

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing_test_port');
  await new Promise<void>(resolve => server.close(() => resolve()));
  return address.port;
}

describe('webhook request and listener ownership', () => {
  it('does not leave an orphaned listener after overlapping starts', async () => {
    const listener = new WebhookInboundListener();
    await Promise.all([
      listener.start({ port: 0, secret: 'first' }, () => {}),
      listener.start({ port: 0, secret: 'second' }, () => {}),
    ]);
    await listener.stop();
    expect(vi.mocked(createServer).mock.results.filter(result => result.type === 'return' && result.value.listening))
      .toHaveLength(0);
  });

  it('stops even when a client never finishes its body and does not emit an event', async () => {
    const port = await freePort();
    const listener = new WebhookInboundListener();
    const onEvent = vi.fn();
    await listener.start({ port, secret: 'test-secret' }, onEvent);
    let socket: Socket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settleWatchdog!: (value: string) => void;
    try {
      socket = connect(port, '127.0.0.1');
      socket.on('error', () => {});
      await once(socket, 'connect');
      socket.write('POST /hooks/selected HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\nx-ax-webhook-secret: test-secret\r\n\r\nx');
      const stopped = listener.stop();
      const result = await Promise.race([
        stopped.then(() => 'stopped'),
        new Promise<string>(resolve => {
          settleWatchdog = resolve;
          timer = setTimeout(() => resolve('still_waiting'), 300);
        }),
      ]);
      expect(result).toBe('stopped');
      expect(onEvent).not.toHaveBeenCalled();
    } finally {
      clearTimeout(timer);
      settleWatchdog?.('cancelled');
      socket?.destroy();
      await listener.stop();
    }
  });

  it.each(['/hooks/other/../selected', '/hooks/other/%2e%2e/selected'])(
    'rejects path traversal before URL normalization: %s', async path => {
      const port = await freePort();
      const listener = new WebhookInboundListener();
      const onEvent = vi.fn();
      await listener.start({ port, secret: 'test-secret' }, onEvent);
      try {
        const status = await new Promise<number | undefined>((resolve, reject) => {
          const req = request({ hostname: '127.0.0.1', port, path, method: 'POST',
            headers: { 'x-ax-webhook-secret': 'test-secret' },
          }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
          req.once('error', reject);
          req.end('{}');
        });
        expect(status).toBe(400);
        expect(onEvent).not.toHaveBeenCalled();
      } finally { await listener.stop(); }
    },
  );
});
