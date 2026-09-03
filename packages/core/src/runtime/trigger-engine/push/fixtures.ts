import { createServer } from 'node:http';
import { expect, vi } from 'vitest';
import { TriggerEngine } from '../../trigger-engine.js';

export async function findFreePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error('failed to allocate a free port');
  return port;
}

export async function waitForWebhookListener(engine: TriggerEngine): Promise<void> {
  await vi.waitFor(() => {
    expect(engine.pushTransportStatus('webhook.inbound')).toMatchObject({ phase: 'connected' });
    expect(engine.pushTransportActive('webhook.inbound')).toBe(true);
  });
}
