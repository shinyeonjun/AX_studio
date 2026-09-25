import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebhookInboundListener } from '../../listener.js';
import { WEBHOOK_MAX_PAYLOAD_BYTES } from '../../security.js';

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a local test port.');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

describe('WebhookInboundListener oversized payload concurrency', () => {
  it('delivers every 413 response before closing oversized request sockets', async () => {
    const listener = new WebhookInboundListener();
    const events: unknown[] = [];
    const port = await unusedPort();
    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });

    try {
      const body = 'x'.repeat(WEBHOOK_MAX_PAYLOAD_BYTES + 1);
      const results = await Promise.all(Array.from({ length: 64 }, async () => {
        const response = await fetch(`http://127.0.0.1:${port}/hooks/test`, {
          method: 'POST',
          headers: { 'x-ax-webhook-secret': 'hook-secret' },
          body,
        });
        return { status: response.status, body: await response.text() };
      }));

      expect(results).toEqual(Array.from({ length: 64 }, () => ({ status: 413, body: 'payload_too_large' })));
      expect(events).toHaveLength(0);
    } finally {
      await listener.stop();
    }
  });
});
