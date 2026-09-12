import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { RdbConnector } from '../connector.js';

describe('RDB host cancellation', () => {
  it('denies an already cancelled SQLite read before opening a file', async () => {
    const connector = new RdbConnector({ type: 'sqlite', filePath: 'does-not-exist.sqlite', allowedTables: ['items'] });
    expect(await connector.execute('query.read', { table: 'items' }, {
      executionId: 'cancelled', variables: {}, log: () => {}, abortSignal: AbortSignal.abort(),
    })).toMatchObject({ ok: false, errorCode: 'aborted' });
  });

  it.each([
    { type: 'postgres', allowHalfOpen: false },
    { type: 'mysql', allowHalfOpen: false },
    { type: 'postgres', allowHalfOpen: true },
  ] as const)('cancels a stalled handshake: %j', async ({ type, allowHalfOpen }) => {
    const controller = new AbortController();
    const sockets = new Set<Socket>();
    let handshakeStarted!: () => void;
    const handshake = new Promise<void>(resolve => { handshakeStarted = resolve; });
    let socketClosed!: () => void;
    const closed = new Promise<void>(resolve => { socketClosed = resolve; });
    const server = createServer({ allowHalfOpen }, socket => {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('data', () => {});
      socket.once('close', () => { sockets.delete(socket); socketClosed(); });
      controller.abort();
      handshakeStarted();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing_test_port');
    const connector = new RdbConnector({
      type, connectionString: `${type}://test@127.0.0.1:${address.port}/test`, allowedTables: ['items'],
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const execution = connector.execute('query.read', { table: 'items' }, {
          executionId: 'cancelled', variables: {}, log: () => {}, abortSignal: controller.signal,
        });
      await handshake;
      const result = await Promise.race([
        execution,
        new Promise(resolve => { timer = setTimeout(() => resolve('did_not_cancel'), 800); }),
      ]);
      expect(result).toMatchObject({ ok: false, errorCode: 'aborted' });
      if (!allowHalfOpen) await closed;
    } finally {
      clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
