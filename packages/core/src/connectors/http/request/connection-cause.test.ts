import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { HttpConnector } from '../connector.js';

describe('an HTTP server that cannot be reached', () => {
  it('says the connection failed instead of Node\'s "fetch failed"', async () => {
    // A port that was free a moment ago: nothing listens there now.
    const port = await new Promise<number>((resolve) => {
      const server = createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = server.address() as { port: number };
        server.close(() => resolve(free));
      });
    });
    const connector = new HttpConnector([{ id: 'down', baseUrl: `http://127.0.0.1:${port}/`, auth: { type: 'none' } }] as never, { allowPrivateNetwork: true });
    const result = await connector.execute('request', { connectionId: 'down', method: 'GET', path: 'orders' }, { executionId: 'x', variables: {}, log: () => undefined });
    expect(result).toMatchObject({ ok: false, error: 'connection_failed', errorCode: 'connection_failed' });
  });
});
