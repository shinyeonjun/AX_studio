import { describe, expect, it, afterEach } from 'vitest';
import { createServer, request } from 'node:http';
import { WebhookInboundListener } from './listener.js';
import { WEBHOOK_MAX_PAYLOAD_BYTES } from './security.js';

describe('WebhookInboundListener', () => {
  const listeners: WebhookInboundListener[] = [];

  afterEach(async () => {
    await Promise.all(listeners.map((listener) => listener.stop()));
    listeners.length = 0;
  });

  it('accepts signed POST and emits trigger event', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const port = 38_901;

    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });

    const response = await fetch(`http://127.0.0.1:${port}/hooks/invoice-paid`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ax-webhook-secret': 'hook-secret',
      },
      body: '{"total":42}',
    });

    expect(response.status).toBe(202);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('webhook.inbound');
    expect(events[0]?.payload.path).toBe('invoice-paid');
    expect(events[0]?.payload.body).toBe('{"total":42}');
  });

  it('decodes URL-encoded webhook paths before emitting the event', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: Array<{ payload: Record<string, unknown> }> = [];
    const port = 38_906;

    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });
    const response = await fetch(`http://127.0.0.1:${port}/hooks/${encodeURIComponent('결제 완료')}`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret' },
      body: '{}',
    });

    expect(response.status).toBe(202);
    expect(events[0]?.payload.path).toBe('결제 완료');
  });

  it('rejects malformed URL encoding in webhook paths', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const port = 38_907;

    await listener.start({ port, secret: 'hook-secret' }, () => undefined);
    const response = await fetch(`http://127.0.0.1:${port}/hooks/%E0%A4%A`, {
      method: 'POST',
      headers: { 'x-ax-webhook-secret': 'hook-secret' },
      body: '{}',
    });

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('invalid_path');
  });

  it('rejects requests without valid secret', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const port = 38_902;

    await listener.start({ port, secret: 'hook-secret' }, () => undefined);
    const response = await fetch(`http://127.0.0.1:${port}/hooks/test`, {
      method: 'POST',
      body: '{}',
    });
    expect(response.status).toBe(401);
  });

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

  it('can restart after its port was initially unavailable', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const address = blocker.address();
    if (!address || typeof address === 'string') throw new Error('test_port_unavailable');

    const listener = new WebhookInboundListener();
    listeners.push(listener);
    await expect(listener.start({ port: address.port, secret: 'hook-secret' }, () => undefined)).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });

    await new Promise<void>((resolve, reject) => blocker.close((error) => (error ? reject(error) : resolve())));
    await listener.start({ port: address.port, secret: 'hook-secret' }, () => undefined);

    expect(listener.isRunning()).toBe(true);
  });
});
