import { request } from 'node:http';
import { WEBHOOK_MAX_PAYLOAD_BYTES } from '../../security.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookInboundListener } from '../../listener.js';
const listeners: WebhookInboundListener[] = [];
afterEach(async () => {
  await Promise.all(listeners.map((listener) => listener.stop()));
  listeners.length = 0;
  vi.restoreAllMocks();
});
describe('WebhookInboundListener payload-size boundaries', () => {
  it('returns 413 without emitting an event when the payload is too large', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: unknown[] = [];
    const port = 38_903;
    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });
    const response = await fetch(`http://127.0.0.1:${port}/hooks/test`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret' },
      body: 'x'.repeat(WEBHOOK_MAX_PAYLOAD_BYTES + 1),
    });
    expect(response.status).toBe(413);
    expect(await response.text()).toBe('payload_too_large');
    expect(events).toHaveLength(0);
  });
  it('rejects an oversized declared payload before waiting for its body', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: unknown[] = [];
    const port = 38_904;
    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });
    const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port,
        path: '/hooks/test',
        method: 'POST',
        headers: {
          'content-length': WEBHOOK_MAX_PAYLOAD_BYTES + 1,
          'x-ax-webhook-secret': 'hook-secret',
        },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject);
      req.end();
    });
    expect(response).toEqual({ status: 413, body: 'payload_too_large' });
    expect(events).toHaveLength(0);
  });
  it('accepts a payload at the configured size limit', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: unknown[] = [];
    const port = 38_905;
    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });
    const response = await fetch(`http://127.0.0.1:${port}/hooks/test`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret' },
      body: 'x'.repeat(WEBHOOK_MAX_PAYLOAD_BYTES),
    });
    expect(response.status).toBe(202);
    expect(events).toHaveLength(1);
  });
});
