import { createHmac } from 'node:crypto';
import { request } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebhookInboundListener } from '../../listener.js';

const listeners: WebhookInboundListener[] = [];

afterEach(async () => {
  await Promise.all(listeners.map((listener) => listener.stop()));
  listeners.length = 0;
  vi.restoreAllMocks();
});

describe('WebhookInboundListener acceptance', () => {
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
        authorization: 'Bearer hook-secret',
        cookie: 'session=should-not-forward',
      },
      body: '{"total":42}',
    });

    expect(response.status).toBe(202);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('webhook.inbound');
    expect(events[0]?.payload.path).toBe('invoice-paid');
    expect(events[0]?.payload.body).toBe('{"total":42}');
    expect(events[0]?.payload.headers).not.toHaveProperty('x-ax-webhook-secret');
    expect(events[0]?.payload.headers).not.toHaveProperty('authorization');
    expect(events[0]?.payload.headers).not.toHaveProperty('cookie');
  });

  it('accepts HMAC requests without forwarding authentication headers', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: Array<{ payload: Record<string, unknown> }> = [];
    const port = 38_914;
    const body = '{"attempt":1}';
    const signature = createHmac('sha256', 'hook-secret').update(body).digest('hex');

    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });

    const response = await fetch(`http://127.0.0.1:${port}/hooks/retryable`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-ax-signature': `sha256=${signature}`,
        'x-api-key': 'should-not-forward',
      },
      body,
    });

    expect(response.status).toBe(202);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload.headers).not.toHaveProperty('x-ax-signature');
    expect(events[0]?.payload.headers).not.toHaveProperty('x-api-key');
  });

  it('routes signed requests independently of the client-supplied host header', async () => {
    const listener = new WebhookInboundListener();
    listeners.push(listener);
    const events: unknown[] = [];
    const port = 38_911;

    await listener.start({ port, secret: 'hook-secret' }, (event) => {
      events.push(event);
    });
    const response = await new Promise<{ status: number | undefined }>((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port,
        path: '/hooks/test',
        method: 'POST',
        headers: {
          host: '][',
          'x-ax-webhook-secret': 'hook-secret',
        },
      }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode }));
      });
      req.on('error', reject);
      req.end('{}');
    });

    expect(response.status).toBe(202);
    expect(events).toHaveLength(1);
  });
});
